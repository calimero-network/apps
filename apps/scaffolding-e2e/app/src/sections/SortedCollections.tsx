import { useState } from "react";
import { ResultBox } from "../components/ResultBox";
import { FieldHelp } from "../components/FieldHelp";
import * as api from "../api/kvStore";


function useCall() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(undefined);
  async function run(fn: () => Promise<unknown>) {
    setLoading(true);
    try {
      setResult(await fn());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }
  return { loading, result, run };
}

export function SortedCollections() {
  const [setKey, setSetKey] = useState("");
  const [setValue, setSetValue] = useState("");
  const [getKey, setGetKey] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [removeKey, setRemoveKey] = useState("");

  const [tag, setTag] = useState("");
  const [tagCheck, setTagCheck] = useState("");
  const [tagRemove, setTagRemove] = useState("");
  const [tagRangeStart, setTagRangeStart] = useState("");
  const [tagRangeEnd, setTagRangeEnd] = useState("");

  const setCall = useCall();
  const getCall = useCall();
  const keysCall = useCall();
  const rangeCall = useCall();
  const lastCall = useCall();
  const removeCall = useCall();
  const lenCall = useCall();

  const tagAddCall = useCall();
  const tagRemoveCall = useCall();
  const tagContainsCall = useCall();
  const tagsAllCall = useCall();
  const tagsRangeCall = useCall();
  const tagsLastCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">Sorted Collections</h2>
        <p className="section-desc">
          <code>SortedMap</code> and <code>SortedSet</code>. Not sorted flavours
          of the unordered pair — these are the only collections that maintain
          the WASM host's <strong>ordered index</strong>, which is what makes a
          range query or “the largest key” a seek instead of a full scan. Ranges
          are half-open: <code>[start, end)</code>, so <code>end</code> is never
          returned.
        </p>
      </div>

      <h3 className="method-group-title">SortedMap — key-ordered</h3>
      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">sorted_set(key, value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={setKey}
              onChange={(e) => setSetKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={setValue}
              onChange={(e) => setSetValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={setCall.loading}
            onClick={() => setCall.run(() => api.sortedSet(setKey, setValue))}
          >
            {setCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_get(key) → string | null</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={getKey}
              onChange={(e) => setGetKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={getCall.loading}
            onClick={() => getCall.run(() => api.sortedGet(getKey))}
          >
            {getCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={getCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_keys() → string[]</div>
          <p className="method-hint">
            Ascending, straight off the index — no scan, no client-side sort.
          </p>
          <button
            className="btn-calimero-outline"
            disabled={keysCall.loading}
            onClick={() => keysCall.run(() => api.sortedKeys())}
          >
            {keysCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={keysCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_range(start, end) → map</div>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input
                className="form-control"
                placeholder="start (inclusive)"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
              />
              <FieldHelp text="Half-open, like every Rust range: start is returned, end is not. A range of a..a is therefore always empty." />
            </div>
            <input
              className="form-control"
              placeholder="end (exclusive)"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={rangeCall.loading}
            onClick={() => rangeCall.run(() => api.sortedRange(rangeStart, rangeEnd))}
          >
            {rangeCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={rangeCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_last_key() → string | null</div>
          <p className="method-hint">A reverse seek: it does not read the rest.</p>
          <button
            className="btn-calimero-outline"
            disabled={lastCall.loading}
            onClick={() => lastCall.run(() => api.sortedLastKey())}
          >
            {lastCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={lastCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_remove(key) → bool</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={removeKey}
              onChange={(e) => setRemoveKey(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={removeCall.loading}
            onClick={() => removeCall.run(() => api.sortedRemove(removeKey))}
          >
            {removeCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={removeCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_len() → number</div>
          <button
            className="btn-calimero-outline"
            disabled={lenCall.loading}
            onClick={() => lenCall.run(() => api.sortedLen())}
          >
            {lenCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={lenCall.result} />
        </div>
      </div>

      <h3 className="method-group-title">SortedSet — element-ordered</h3>
      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">sorted_tag_add(tag) → bool</div>
          <p className="method-hint">
            <code>true</code> when it was newly added, <code>false</code> when it
            was already there.
          </p>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="tag"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={tagAddCall.loading}
            onClick={() => tagAddCall.run(() => api.sortedTagAdd(tag))}
          >
            {tagAddCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={tagAddCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_tag_remove(tag) → bool</div>
          <div className="method-inputs">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
              <input
                className="form-control"
                placeholder="tag"
                value={tagRemove}
                onChange={(e) => setTagRemove(e.target.value)}
              />
              <FieldHelp text="Removing and re-adding the same element used to never converge across nodes (fixed in rc.10). Worth re-adding after a remove and checking every node agrees." />
            </div>
          </div>
          <button
            className="btn-calimero-outline"
            disabled={tagRemoveCall.loading}
            onClick={() => tagRemoveCall.run(() => api.sortedTagRemove(tagRemove))}
          >
            {tagRemoveCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={tagRemoveCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_tag_contains(tag) → bool</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="tag"
              value={tagCheck}
              onChange={(e) => setTagCheck(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={tagContainsCall.loading}
            onClick={() => tagContainsCall.run(() => api.sortedTagContains(tagCheck))}
          >
            {tagContainsCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={tagContainsCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_tags_all() → string[]</div>
          <button
            className="btn-calimero-outline"
            disabled={tagsAllCall.loading}
            onClick={() => tagsAllCall.run(() => api.sortedTagsAll())}
          >
            {tagsAllCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={tagsAllCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_tags_range(start, end) → string[]</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="start (inclusive)"
              value={tagRangeStart}
              onChange={(e) => setTagRangeStart(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="end (exclusive)"
              value={tagRangeEnd}
              onChange={(e) => setTagRangeEnd(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero-outline"
            disabled={tagsRangeCall.loading}
            onClick={() => tagsRangeCall.run(() => api.sortedTagsRange(tagRangeStart, tagRangeEnd))}
          >
            {tagsRangeCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={tagsRangeCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">sorted_tags_last() → string | null</div>
          <button
            className="btn-calimero-outline"
            disabled={tagsLastCall.loading}
            onClick={() => tagsLastCall.run(() => api.sortedTagsLast())}
          >
            {tagsLastCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={tagsLastCall.result} />
        </div>
      </div>
    </div>
  );
}
