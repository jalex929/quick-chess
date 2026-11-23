import { BOT_LEVELS } from "../engine/bot";
import { TIME_CONTROLS } from "../engine/clock";
import type { PieceFacing, Settings } from "../engine/session";
import { track } from "../telemetry";
import { PieceIcon } from "./Pieces";
import { playIfOn } from "./sound";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onStart: (s: Settings) => void;
}

/** One group of choices shown as a row of chunky buttons (radio buttons underneath). */
function Choice<T extends string | null>({
  legend,
  note,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  /** A short line under the heading, shown on every screen size. */
  note?: string;
  name: string;
  value: T;
  options: { value: T; label: string; hint?: string; tag?: string; art?: React.ReactNode }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className={`choice choice--${name}`}>
      <legend className="choice__legend">{legend}</legend>
      {note && <p className="choice__note">{note}</p>}
      <div className="choice__options">
        {options.map((o) => (
          <label key={String(o.value)} className="choice__option">
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
            />
            <span className="choice__box">
              {o.art}
              <span className="choice__label">{o.label}</span>
              {o.tag && <span className="choice__tag">{o.tag}</span>}
              {o.hint && <span className="choice__hint">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Setup({ settings, onChange, onStart }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    track("setup_change", { field: key, value: value as string | null });
    playIfOn("option");
    onChange({ ...settings, [key]: value });
  };

  return (
    <main className="setup">
      <div className="setup__intro">
        <p className="setup__kicker">// new match</p>
        <h2 className="setup__title">
          Power up.
          <br />
          Play a fast game.
        </h2>
        <p className="setup__lede">
          Take on the bot or pass the device to a friend. Your picks are remembered, so next time
          it's one tap.
        </p>
        <div className="setup__art" aria-hidden="true">
          <PieceIcon type="n" color="w" />
          <PieceIcon type="k" color="b" />
          <PieceIcon type="q" color="w" />
        </div>
      </div>

      <form
        className="setup__form"
        onSubmit={(e) => {
          e.preventDefault();
          playIfOn("start");
          onStart(settings);
        }}
      >
        <fieldset className="mode">
          <legend className="choice__legend">Opponent</legend>
          <div className="mode__options">
            {(
              [
                ["bot", "vs Bot", "Pick a level and a side"],
                ["pass", "Pass & play", "Two players, one device"],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="mode__option">
                <input
                  type="radio"
                  name="mode"
                  checked={settings.mode === value}
                  onChange={() => set("mode", value)}
                />
                <span className="mode__box">
                  <span className="mode__label">{label}</span>
                  <span className="mode__hint">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {settings.mode === "bot" ? (
          <>
            <Choice
              legend="Bot level"
              name="level"
              value={settings.level}
              options={BOT_LEVELS.map((l) => ({
                value: l.id,
                label: l.label,
                hint: l.hint,
                tag: l.rating,
              }))}
              onChange={(v) => set("level", v)}
            />
            <Choice
              legend="You play"
              name="side"
              value={settings.side}
              options={[
                { value: "w", label: "White", hint: "Move first" },
                { value: "random", label: "Random" },
                { value: "b", label: "Black", hint: "Bot moves first" },
              ]}
              onChange={(v) => set("side", v)}
            />
          </>
        ) : (
          <>
            <Choice
              legend="Board"
              note="Spins: hand the device over after each move. Stays put: lay it flat and sit across from each other."
              name="passView"
              value={settings.passView}
              options={[
                {
                  value: "flip",
                  label: "Spins each move",
                  hint: "Whoever's turn it is sees their side at the bottom",
                },
                {
                  value: "face",
                  label: "Stays put",
                  hint: "White at the bottom, Black at the top",
                },
              ]}
              onChange={(v) => set("passView", v)}
            />
            {settings.passView === "face" && (
              <Choice
                legend="Pieces face"
                note="Which way the pieces point while the board stays put."
                name="pieceFacing"
                value={settings.pieceFacing}
                options={FACING_OPTIONS.map((o) => ({
                  ...o,
                  art: <FacingArt facing={o.value} />,
                }))}
                onChange={(v) => set("pieceFacing", v)}
              />
            )}
          </>
        )}

        <Choice
          legend="Clock"
          note={'Minutes for each player. "+ 2" adds 2 seconds after every move you make.'}
          name="clock"
          value={settings.clock}
          options={[
            { value: null, label: "None", tag: "Casual", hint: "No clock, take your time" },
            ...TIME_CONTROLS.map((t) => ({
              value: t.id as string | null,
              label: t.label,
              tag: t.kind,
              hint: t.hint,
            })),
          ]}
          onChange={(v) => set("clock", v)}
        />

        <button type="submit" className="button button--primary button--start">
          Start game <span aria-hidden="true">→</span>
        </button>
      </form>
    </main>
  );
}

const FACING_OPTIONS: { value: PieceFacing; label: string; hint: string }[] = [
  { value: "owner", label: "Their player", hint: "Yours face you, theirs face them" },
  { value: "turn", label: "Whose turn", hint: "Every piece turns to the player moving" },
  { value: "one-way", label: "One way", hint: "All upright for the White side" },
  { value: "sideways", label: "Sideways", hint: "A quarter turn, readable from both sides" },
];

/**
 * A tiny picture of each facing: a Black knight at the top edge and a White knight at the
 * bottom, turned the way that option turns them. Decorative; the label says the same thing.
 */
function FacingArt({ facing }: { facing: PieceFacing }) {
  const angle = (c: "w" | "b") =>
    facing === "owner" ? (c === "b" ? 180 : 0) : facing === "sideways" ? 90 : 0;
  return (
    <span className={`facing-art facing-art--${facing}`} aria-hidden="true">
      <span className="facing-art__piece" style={{ rotate: `${angle("b")}deg` }}>
        <PieceIcon type="n" color="b" />
      </span>
      <span className="facing-art__piece" style={{ rotate: `${angle("w")}deg` }}>
        <PieceIcon type="n" color="w" />
      </span>
      {facing === "turn" && <span className="facing-art__turn">↻</span>}
    </span>
  );
}
