import { useCallback, useState } from "react";
import { ArrowLeft, Refresh } from "@calimero-network/mero-icons";
import { useNavigate } from "react-router-dom";
import { ArenaCanvas } from "./ArenaCanvas";
import { FighterSelect } from "./FighterSelect";
import { SoundToggle } from "./SoundToggle";
import { TouchPad } from "./TouchPad";
import { ROSTER, type FighterId } from "./game/fighters";
import type { Button } from "./game/input";
import { rememberFighter, storedFighter } from "./useArena";

/**
 * Practice against the CPU — no node, no transactions. The same engine, the
 * same fighters; just nobody on the other side of the network.
 */
export function PracticePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<FighterId>(storedFighter);
  const cpu = ROSTER.find((f) => f.id !== me)?.id ?? "cryo";
  const [press, setPress] = useState<((b: Button, down: boolean) => void) | null>(null);
  const [over, setOver] = useState(false);
  const [restart, setRestart] = useState(0);
  const onControls = useCallback((fn: (b: Button, down: boolean) => void) => setPress(() => fn), []);

  return (
    <div className="arena-page">
      <div className="arena-head">
        <div className="arena-title">
          <p className="eyebrow">Practice · offline</p>
          <h1>You versus the CPU</h1>
        </div>
        <div className="row">
          <SoundToggle />
          {over && (
            <button className="small" onClick={() => setRestart((n) => n + 1)}>
              <Refresh size={14} aria-hidden="true" /> Rematch
            </button>
          )}
          <button className="ghost small" onClick={() => navigate("/play")}>
            <ArrowLeft size={15} aria-hidden="true" /> Back to arenas
          </button>
        </div>
      </div>

      <div className="arena-layout">
        <section className="cabinet-col">
          <div className="cabinet">
            <ArenaCanvas
              mode="cpu"
              local={0}
              fighters={[me, cpu]}
              onControls={onControls}
              onOver={setOver}
              restartKey={restart}
              label="Practice fight against the CPU"
            />
          </div>
          <TouchPad press={press} />
        </section>
        <aside className="side-col">
          <div className="card">
            <div className="card-head">
              <h2>Choose your fighter</h2>
            </div>
            <FighterSelect
              value={me}
              onChange={(id) => {
                setMe(id);
                rememberFighter(id);
              }}
            />
          </div>
          <div className="card">
            <div className="card-head">
              <h2>Practice is off the chain</h2>
            </div>
            <p className="hint flush">
              Nothing here is a transaction. In a real arena every punch, kick, jump and block you finish is a
              contract call on your node, gossiped to your opponent&apos;s — and the health bars are what the
              contract derives from them.
            </p>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="small" onClick={() => navigate("/play")}>
                Fight a real opponent
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
