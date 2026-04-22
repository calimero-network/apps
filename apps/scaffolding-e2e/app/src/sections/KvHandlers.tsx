import { useState } from "react";
import { ResultBox } from "../components/ResultBox";
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

export function KvHandlers() {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [removeKey, setRemoveKey] = useState("");
  const [insertKey, setInsertKey] = useState("");
  const [insertValue, setInsertValue] = useState("");
  const [updateKey, setUpdateKey] = useState("");
  const [updateValue, setUpdateValue] = useState("");
  const [rmHandlerKey, setRmHandlerKey] = useState("");

  const setWithHandler = useCall();
  const removeWithHandler = useCall();
  const clearWithHandler = useCall();
  const getCount = useCall();
  const insertHandlerCall = useCall();
  const updateHandlerCall = useCall();
  const removeHandlerCall = useCall();
  const clearHandlerCall = useCall();

  return (
    <div>
      <div className="section-header">
        <h2 className="section-title">KV with Handlers</h2>
        <p className="section-desc">
          KV operations that emit named event handlers on execution.
        </p>
      </div>

      <div className="method-grid">
        <div className="method-card">
          <div className="method-name">set_with_handler(key, value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={setWithHandler.loading}
            onClick={() =>
              setWithHandler.run(() => api.kvSetWithHandler(key, value))
            }
          >
            {setWithHandler.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={setWithHandler.result} />
        </div>

        <div className="method-card">
          <div className="method-name">remove_with_handler(key)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={removeKey}
              onChange={(e) => setRemoveKey(e.target.value)}
            />
          </div>
          <button
            className="btn-danger-outline"
            disabled={removeWithHandler.loading}
            onClick={() =>
              removeWithHandler.run(() =>
                api.kvRemoveWithHandler(removeKey),
              )
            }
          >
            {removeWithHandler.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={removeWithHandler.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            clear_with_handler() / get_handler_execution_count()
          </div>
          <div className="input-row" style={{ marginBottom: 0 }}>
            <button
              className="btn-danger-outline"
              disabled={clearWithHandler.loading}
              onClick={() =>
                clearWithHandler.run(() => api.kvClearWithHandler())
              }
            >
              {clearWithHandler.loading ? "..." : "clear_with_handler"}
            </button>
            <button
              className="btn-calimero-outline"
              disabled={getCount.loading}
              onClick={() =>
                getCount.run(() => api.getHandlerExecutionCount())
              }
            >
              {getCount.loading ? "..." : "get_count"}
            </button>
          </div>
          <ResultBox result={clearWithHandler.result} />
          <ResultBox result={getCount.result} />
        </div>

        <div className="method-card">
          <div className="method-name">insert_handler(key, value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={insertKey}
              onChange={(e) => setInsertKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={insertValue}
              onChange={(e) => setInsertValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={insertHandlerCall.loading}
            onClick={() =>
              insertHandlerCall.run(() =>
                api.insertHandler(insertKey, insertValue),
              )
            }
          >
            {insertHandlerCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={insertHandlerCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">update_handler(key, value)</div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={updateKey}
              onChange={(e) => setUpdateKey(e.target.value)}
            />
            <input
              className="form-control"
              placeholder="value"
              value={updateValue}
              onChange={(e) => setUpdateValue(e.target.value)}
            />
          </div>
          <button
            className="btn-calimero"
            disabled={updateHandlerCall.loading}
            onClick={() =>
              updateHandlerCall.run(() =>
                api.updateHandler(updateKey, updateValue),
              )
            }
          >
            {updateHandlerCall.loading ? "..." : "Execute"}
          </button>
          <ResultBox result={updateHandlerCall.result} />
        </div>

        <div className="method-card">
          <div className="method-name">
            remove_handler(key) / clear_handler()
          </div>
          <div className="method-inputs">
            <input
              className="form-control"
              placeholder="key"
              value={rmHandlerKey}
              onChange={(e) => setRmHandlerKey(e.target.value)}
            />
          </div>
          <div className="input-row">
            <button
              className="btn-danger-outline"
              disabled={removeHandlerCall.loading}
              onClick={() =>
                removeHandlerCall.run(() => api.removeHandler(rmHandlerKey))
              }
            >
              {removeHandlerCall.loading ? "..." : "remove_handler"}
            </button>
            <button
              className="btn-danger-outline"
              disabled={clearHandlerCall.loading}
              onClick={() =>
                clearHandlerCall.run(() => api.clearHandler())
              }
            >
              {clearHandlerCall.loading ? "..." : "clear_handler"}
            </button>
          </div>
          <ResultBox result={removeHandlerCall.result} />
          <ResultBox result={clearHandlerCall.result} />
        </div>
      </div>
    </div>
  );
}
