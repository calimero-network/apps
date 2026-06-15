import XCTest
import simd
@testable import MeroAR

/// The AR layer must round-trip transforms through a decomposed
/// position/quaternion/scale form (never raw matrices over the wire). These
/// guard the `simd_float4x4 ⇄ Transform` conversion.
final class TransformMathTests: XCTestCase {

    func testIdentityRoundTrip() {
        let t = Transform(matrix: matrix_identity_float4x4)
        XCTAssertEqual(t.position.x, 0, accuracy: 1e-5)
        XCTAssertEqual(t.position.y, 0, accuracy: 1e-5)
        XCTAssertEqual(t.scale.x, 1, accuracy: 1e-5)
        XCTAssertEqual(t.rotation.w, 1, accuracy: 1e-5)
    }

    func testTranslationExtracted() {
        var m = matrix_identity_float4x4
        m.columns.3 = SIMD4(1.5, -2.0, 3.25, 1)
        let t = Transform(matrix: m)
        XCTAssertEqual(t.position.x, 1.5, accuracy: 1e-5)
        XCTAssertEqual(t.position.y, -2.0, accuracy: 1e-5)
        XCTAssertEqual(t.position.z, 3.25, accuracy: 1e-5)
    }

    func testScaleExtracted() {
        let model = Transform(position: Vec3(0, 0, 0),
                              rotation: Quat(0, 0, 0, 1),
                              scale: Vec3(2, 3, 4))
        let rebuilt = Transform(matrix: model.matrix)
        XCTAssertEqual(rebuilt.scale.x, 2, accuracy: 1e-4)
        XCTAssertEqual(rebuilt.scale.y, 3, accuracy: 1e-4)
        XCTAssertEqual(rebuilt.scale.z, 4, accuracy: 1e-4)
    }

    func testRotationRoundTrip() {
        // 90° about Y.
        let q = simd_quatf(angle: .pi / 2, axis: SIMD3(0, 1, 0))
        let model = Transform(position: Vec3(0, 0, 0), rotation: Quat(q), scale: Vec3(1, 1, 1))
        let rebuilt = Transform(matrix: model.matrix)
        // Rotating +X by the rebuilt quaternion should give ~ -Z.
        let rotated = rebuilt.rotation.simd.act(SIMD3(1, 0, 0))
        XCTAssertEqual(rotated.x, 0, accuracy: 1e-4)
        XCTAssertEqual(rotated.z, -1, accuracy: 1e-4)
    }

    func testFullPoseRoundTrip() {
        let q = simd_quatf(angle: .pi / 3, axis: normalize(SIMD3<Float>(1, 1, 0)))
        let model = Transform(position: Vec3(5, -1, 2), rotation: Quat(q), scale: Vec3(1, 1, 1))
        let m = model.matrix
        let back = Transform(matrix: m)
        XCTAssertEqual(back.position.x, 5, accuracy: 1e-4)
        XCTAssertEqual(back.position.z, 2, accuracy: 1e-4)
        // matrix should reconstruct equivalently
        let m2 = back.matrix
        XCTAssertEqual(m.columns.3.x, m2.columns.3.x, accuracy: 1e-4)
    }
}
