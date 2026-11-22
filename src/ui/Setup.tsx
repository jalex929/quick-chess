import { BOT_LEVELS } from "../engine/bot";
import { TIME_CONTROLS } from "../engine/clock";
import type { Settings } from "../engine/session";
import { PieceIcon } from "./Pieces";

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  onStart: (s: Settings) => void;
}

/** One group of choices shown as a row of chunky buttons (radio buttons underneath). */
function Choice<T extends string | null>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="choice">
      <legend className="choice__legend">{legend}</legend>
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
              <span className="choice__label">{o.label}</span>
              {o.hint && <span className="choice__hint">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Setup({ settings, onChange, onStart }: Props) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

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
              options={BOT_LEVELS.map((l) => ({ value: l.id, label: l.label, hint: l.hint }))}
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
          <Choice
            legend="Board"
            name="passView"
            value={settings.passView}
            options={[
              { value: "flip", label: "Turns each move", hint: "Pass it across" },
              { value: "face", label: "Stays put", hint: "Sit face to face" },
            ]}
            onChange={(v) => set("passView", v)}
          />
        )}

        <Choice
          legend="Clock"
          name="clock"
          value={settings.clock}
          options={[
            { value: null, label: "None" },
            ...TIME_CONTROLS.map((t) => ({ value: t.id as string | null, label: t.label })),
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
