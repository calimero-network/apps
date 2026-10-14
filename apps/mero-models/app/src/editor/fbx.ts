/**
 * A binary FBX 7.4 writer for static meshes: what Unreal, Unity and most
 * DCCs import. It writes the layout Blender's exporter does — header, node
 * records, the fixed file id, creation time and footer the FBX SDK checks —
 * with meshes as triangles carrying per-corner normals and UVs, one material
 * each with its base colour and normal textures referenced by file name, and
 * every model at the scene root with its own transform.
 *
 * Units are centimetres (UnitScaleFactor 1), Y up, as the FBX default; the
 * caller hands positions in metres and they are scaled here.
 */

export interface FbxMesh {
  name: string;
  /** Triangles, three corners each, with positions (metres), normals and optional UVs per corner. */
  positions: Float32Array | number[];
  normals: Float32Array | number[];
  uvs?: Float32Array | number[] | null;
  /** Translation (metres), rotation as XYZ-extrinsic Euler degrees (FBX's default order), scale. */
  translation: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  material?: FbxMaterial | null;
}

export interface FbxMaterial {
  name: string;
  color: [number, number, number];
  /** File names of textures written beside the FBX. */
  baseColorFile?: string;
  normalFile?: string;
}

// ── encoding ────────────────────────────────────────────────────────────────

type Prop =
  | { t: "I"; v: number }
  | { t: "L"; v: bigint }
  | { t: "D"; v: number }
  | { t: "C"; v: boolean }
  | { t: "S"; v: string }
  | { t: "R"; v: Uint8Array }
  | { t: "d"; v: ArrayLike<number> }
  | { t: "i"; v: ArrayLike<number> };

interface Node {
  name: string;
  props: Prop[];
  children: Node[];
}

const I = (v: number): Prop => ({ t: "I", v });
const L = (v: number | bigint): Prop => ({ t: "L", v: BigInt(v) });
const D = (v: number): Prop => ({ t: "D", v });
const S = (v: string): Prop => ({ t: "S", v });
const node = (name: string, props: Prop[] = [], children: Node[] = []): Node => ({ name, props, children });
/** A Properties70 entry. */
const P = (name: string, type: string, sub: string, flags: string, ...values: Prop[]) => node("P", [S(name), S(type), S(sub), S(flags), ...values]);

const encoder = new TextEncoder();

function propBytes(p: Prop): Uint8Array {
  const code = p.t.charCodeAt(0);
  switch (p.t) {
    case "I": {
      const b = new Uint8Array(5);
      b[0] = code;
      new DataView(b.buffer).setInt32(1, p.v, true);
      return b;
    }
    case "L": {
      const b = new Uint8Array(9);
      b[0] = code;
      new DataView(b.buffer).setBigInt64(1, p.v, true);
      return b;
    }
    case "D": {
      const b = new Uint8Array(9);
      b[0] = code;
      new DataView(b.buffer).setFloat64(1, p.v, true);
      return b;
    }
    case "C":
      return Uint8Array.from([code, p.v ? 1 : 0]);
    case "S":
    case "R": {
      const data = p.t === "S" ? encoder.encode(p.v) : p.v;
      const b = new Uint8Array(5 + data.length);
      b[0] = code;
      new DataView(b.buffer).setUint32(1, data.length, true);
      b.set(data, 5);
      return b;
    }
    case "d":
    case "i": {
      const width = p.t === "d" ? 8 : 4;
      const n = p.v.length;
      const b = new Uint8Array(13 + n * width);
      const view = new DataView(b.buffer);
      b[0] = code;
      view.setUint32(1, n, true);
      view.setUint32(5, 0, true); // not compressed
      view.setUint32(9, n * width, true);
      for (let i = 0; i < n; i += 1) {
        if (p.t === "d") view.setFloat64(13 + i * 8, p.v[i]!, true);
        else view.setInt32(13 + i * 4, p.v[i]!, true);
      }
      return b;
    }
  }
}

const SENTINEL = new Uint8Array(13);

/** A node record (FBX < 7.5: 32-bit offsets), its end offset relative to the file start. */
function writeNode(n: Node, start: number, out: Uint8Array[]): number {
  const props = n.props.map(propBytes);
  const propLen = props.reduce((s, b) => s + b.length, 0);
  const name = encoder.encode(n.name);
  const head = new Uint8Array(13 + name.length);
  out.push(head);
  for (const b of props) out.push(b);
  let offset = start + head.length + propLen;
  if (n.children.length || !n.props.length) {
    for (const c of n.children) offset = writeNode(c, offset, out);
    out.push(SENTINEL);
    offset += SENTINEL.length;
  }
  const view = new DataView(head.buffer);
  view.setUint32(0, offset, true);
  view.setUint32(4, n.props.length, true);
  view.setUint32(8, propLen, true);
  head[12] = name.length;
  head.set(name, 13);
  return offset;
}

// The fixed values Blender writes, which the FBX SDK accepts without a real timestamp.
const FILE_ID = Uint8Array.from([0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1]);
const FOOT_ID = Uint8Array.from([0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e]);
const FOOT_MAGIC = Uint8Array.from([0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b]);
const VERSION = 7400;

function encode(roots: Node[]): Uint8Array {
  const header = new Uint8Array(27);
  header.set(encoder.encode("Kaydara FBX Binary  "), 0);
  header[20] = 0;
  header[21] = 0x1a;
  header[22] = 0;
  new DataView(header.buffer).setUint32(23, VERSION, true);
  const out: Uint8Array[] = [header];
  let offset = header.length;
  for (const r of roots) offset = writeNode(r, offset, out);
  out.push(SENTINEL);
  offset += SENTINEL.length;
  out.push(FOOT_ID, new Uint8Array(4));
  offset += 20;
  let pad = ((offset + 15) & ~15) - offset;
  if (pad === 0) pad = 16;
  out.push(new Uint8Array(pad));
  const version = new Uint8Array(4);
  new DataView(version.buffer).setUint32(0, VERSION, true);
  out.push(version, new Uint8Array(120), FOOT_MAGIC);
  const total = out.reduce((s, b) => s + b.length, 0);
  const file = new Uint8Array(total);
  let o = 0;
  for (const b of out) {
    file.set(b, o);
    o += b.length;
  }
  return file;
}

// ── the scene ───────────────────────────────────────────────────────────────

const CM = 100;
const join = (name: string, cls: string) => `${name}\u0000\u0001${cls}`;

/** Encode meshes as a binary FBX file. */
export function writeFbx(meshes: FbxMesh[], creator = "Mero Models"): Uint8Array {
  let nextId = 1_000_000;
  const id = () => nextId++;
  const objects: Node[] = [];
  const connections: Node[] = [];
  let materials = 0;
  let textures = 0;
  for (const m of meshes) {
    const model = id();
    const geometry = id();
    const corners = m.positions.length / 3;
    const vertices = new Float64Array(corners * 3);
    for (let i = 0; i < corners * 3; i += 1) vertices[i] = m.positions[i]! * CM;
    // One polygon per triangle; the last index of each is stored as −(i + 1).
    const polygon = new Int32Array(corners);
    for (let i = 0; i < corners; i += 1) polygon[i] = i % 3 === 2 ? -(i + 1) : i;
    const layers: Node[] = [node("LayerElement", [], [node("Type", [S("LayerElementNormal")]), node("TypedIndex", [I(0)])])];
    const geomChildren: Node[] = [
      node("Properties70"),
      node("GeometryVersion", [I(124)]),
      node("Vertices", [{ t: "d", v: vertices }]),
      node("PolygonVertexIndex", [{ t: "i", v: polygon }]),
      node("LayerElementNormal", [I(0)], [
        node("Version", [I(101)]),
        node("Name", [S("")]),
        node("MappingInformationType", [S("ByPolygonVertex")]),
        node("ReferenceInformationType", [S("Direct")]),
        node("Normals", [{ t: "d", v: Float64Array.from(m.normals) }]),
      ]),
    ];
    if (m.uvs && m.uvs.length === corners * 2) {
      geomChildren.push(
        node("LayerElementUV", [I(0)], [
          node("Version", [I(101)]),
          node("Name", [S("UVMap")]),
          node("MappingInformationType", [S("ByPolygonVertex")]),
          node("ReferenceInformationType", [S("IndexToDirect")]),
          node("UV", [{ t: "d", v: Float64Array.from(m.uvs) }]),
          node("UVIndex", [{ t: "i", v: Int32Array.from({ length: corners }, (_, i) => i) }]),
        ]),
      );
      layers.push(node("LayerElement", [], [node("Type", [S("LayerElementUV")]), node("TypedIndex", [I(0)])]));
    }
    if (m.material) {
      geomChildren.push(
        node("LayerElementMaterial", [I(0)], [
          node("Version", [I(101)]),
          node("Name", [S("")]),
          node("MappingInformationType", [S("AllSame")]),
          node("ReferenceInformationType", [S("IndexToDirect")]),
          node("Materials", [{ t: "i", v: [0] }]),
        ]),
      );
      layers.push(node("LayerElement", [], [node("Type", [S("LayerElementMaterial")]), node("TypedIndex", [I(0)])]));
    }
    geomChildren.push(node("Layer", [I(0)], [node("Version", [I(100)]), ...layers]));
    objects.push(node("Geometry", [L(geometry), S(join(m.name, "Geometry")), S("Mesh")], geomChildren));
    objects.push(
      node("Model", [L(model), S(join(m.name, "Model")), S("Mesh")], [
        node("Version", [I(232)]),
        node("Properties70", [], [
          P("Lcl Translation", "Lcl Translation", "", "A", D(m.translation[0] * CM), D(m.translation[1] * CM), D(m.translation[2] * CM)),
          P("Lcl Rotation", "Lcl Rotation", "", "A", D(m.rotation[0]), D(m.rotation[1]), D(m.rotation[2])),
          P("Lcl Scaling", "Lcl Scaling", "", "A", D(m.scale[0]), D(m.scale[1]), D(m.scale[2])),
          P("DefaultAttributeIndex", "int", "Integer", "", I(0)),
          P("InheritType", "enum", "", "", I(1)),
        ]),
        node("Shading", [{ t: "C", v: true }]),
        node("Culling", [S("CullingOff")]),
      ]),
    );
    connections.push(node("C", [S("OO"), L(model), L(0)]));
    connections.push(node("C", [S("OO"), L(geometry), L(model)]));
    if (m.material) {
      const mat = id();
      materials += 1;
      const [r, g, b] = m.material.color;
      objects.push(
        node("Material", [L(mat), S(join(m.material.name, "Material")), S("")], [
          node("Version", [I(102)]),
          node("ShadingModel", [S("phong")]),
          node("MultiLayer", [I(0)]),
          node("Properties70", [], [
            P("DiffuseColor", "Color", "", "A", D(r), D(g), D(b)),
            P("Diffuse", "Vector3D", "Vector", "", D(r), D(g), D(b)),
            P("Opacity", "double", "Number", "", D(1)),
          ]),
        ]),
      );
      connections.push(node("C", [S("OO"), L(mat), L(model)]));
      for (const [file, property] of [
        [m.material.baseColorFile, "DiffuseColor"],
        [m.material.normalFile, "NormalMap"],
      ] as const) {
        if (!file) continue;
        const tex = id();
        const video = id();
        textures += 1;
        const label = file.replace(/\.[^.]+$/, "");
        objects.push(
          node("Texture", [L(tex), S(join(label, "Texture")), S("")], [
            node("Type", [S("TextureVideoClip")]),
            node("Version", [I(202)]),
            node("TextureName", [S(join(label, "Texture"))]),
            node("Properties70", [], [P("UVSet", "KString", "", "", S("UVMap")), P("UseMaterial", "bool", "", "", I(1))]),
            node("Media", [S(join(label, "Video"))]),
            node("FileName", [S(file)]),
            node("RelativeFilename", [S(file)]),
          ]),
          node("Video", [L(video), S(join(label, "Video")), S("Clip")], [
            node("Type", [S("Clip")]),
            node("Properties70", [], [P("Path", "KString", "XRefUrl", "", S(file))]),
            node("UseMipMap", [I(0)]),
            node("Filename", [S(file)]),
            node("RelativeFilename", [S(file)]),
          ]),
        );
        connections.push(node("C", [S("OP"), L(tex), L(mat), S(property)]));
        connections.push(node("C", [S("OO"), L(video), L(tex)]));
      }
    }
  }
  const definition = (type: string, count: number) => node("ObjectType", [S(type)], [node("Count", [I(count)])]);
  const roots: Node[] = [
    node("FBXHeaderExtension", [], [
      node("FBXHeaderVersion", [I(1003)]),
      node("FBXVersion", [I(VERSION)]),
      node("EncryptionType", [I(0)]),
      node("CreationTimeStamp", [], [
        node("Version", [I(1000)]),
        node("Year", [I(1970)]),
        node("Month", [I(1)]),
        node("Day", [I(1)]),
        node("Hour", [I(10)]),
        node("Minute", [I(0)]),
        node("Second", [I(0)]),
        node("Millisecond", [I(0)]),
      ]),
      node("Creator", [S(creator)]),
    ]),
    node("FileId", [{ t: "R", v: FILE_ID }]),
    node("CreationTime", [S("1970-01-01 10:00:00:000")]),
    node("Creator", [S(creator)]),
    node("GlobalSettings", [], [
      node("Version", [I(1000)]),
      node("Properties70", [], [
        P("UpAxis", "int", "Integer", "", I(1)),
        P("UpAxisSign", "int", "Integer", "", I(1)),
        P("FrontAxis", "int", "Integer", "", I(2)),
        P("FrontAxisSign", "int", "Integer", "", I(1)),
        P("CoordAxis", "int", "Integer", "", I(0)),
        P("CoordAxisSign", "int", "Integer", "", I(1)),
        P("OriginalUpAxis", "int", "Integer", "", I(1)),
        P("OriginalUpAxisSign", "int", "Integer", "", I(1)),
        P("UnitScaleFactor", "double", "Number", "", D(1)),
        P("OriginalUnitScaleFactor", "double", "Number", "", D(1)),
      ]),
    ]),
    node("Documents", [], [node("Count", [I(1)]), node("Document", [L(999_999), S("Scene"), S("Scene")], [node("RootNode", [L(0)])])]),
    node("References"),
    node("Definitions", [], [
      node("Version", [I(100)]),
      node("Count", [I(1 + meshes.length * 2 + materials + textures * 2)]),
      definition("GlobalSettings", 1),
      definition("Model", meshes.length),
      definition("Geometry", meshes.length),
      ...(materials ? [definition("Material", materials)] : []),
      ...(textures ? [definition("Texture", textures), definition("Video", textures)] : []),
    ]),
    node("Objects", [], objects),
    node("Connections", [], connections),
  ];
  return encode(roots);
}
