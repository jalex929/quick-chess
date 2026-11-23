import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
  ALL_SQUARES,
  Game,
  fromUci,
  isLightSquare,
  type Color,
  type MoveInput,
  type PieceType,
  type Square,
} from "../engine/game";
import { PIECE_COLORS, pieceSvg } from "./Pieces";

export { GIF_PLIES };

import { GIF_PLIES } from "./gifConstants";

const SIZE = 480;
const SQ = SIZE / 8;
const HEADER = 44;
const FOOTER = 44;
const WIDTH = SIZE;
const HEIGHT = HEADER + SIZE + FOOTER;

const COLORS = {
  bg: "#0b0716",
  light: "#2f2257",
  dark: "#191036",
  text: "#efeaff",
  muted: "#b0a7d6",
  cyan: "#2ef2ff",
  pink: "#ff2e97",
  last: "rgba(46, 242, 255, 0.18)",
};

export type Tone = "win" | "lose" | "draw";
const TONE_COLOR: Record<Tone, string> = { win: "#c8ff3c", lose: "#ff4d5e", draw: "#ffb627" };

export interface GifRequest {
  moves: string[];
  orientation: Color;
  banner: string;
  subtitle: string;
  tone: Tone;
}

/**
 * Which positions the GIF shows: the last GIF_PLIES moves (or all of them in a short game).
 * Returns the index of the first move to animate.
 */
export function replayStart(moveCount: number, plies = GIF_PLIES): number {
  return Math.max(0, moveCount - plies);
}

const pieceImages = new Map<string, HTMLImageElement>();

function loadPiece(type: PieceType, color: Color): Promise<HTMLImageElement> {
  const key = type + color;
  const cached = pieceImages.get(key);
  if (cached?.complete) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pieceSvg(type, color, 120))}`;
    pieceImages.set(key, img);
  });
}

async function loadAllPieces() {
  const types: PieceType[] = ["p", "n", "b", "r", "q", "k"];
  await Promise.all(types.flatMap((t) => (["w", "b"] as Color[]).map((c) => loadPiece(t, c))));
}

function squareXY(sq: Square, orientation: Color): [number, number] {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  const col = orientation === "w" ? file : 7 - file;
  const row = orientation === "w" ? 7 - rank : rank;
  return [col * SQ, HEADER + row * SQ];
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  type: PieceType,
  color: Color,
  x: number,
  y: number,
) {
  const img = pieceImages.get(type + color);
  if (!img) return;
  ctx.save();
  ctx.shadowColor = PIECE_COLORS[color].glow;
  ctx.shadowBlur = 10;
  const pad = SQ * 0.06;
  ctx.drawImage(img, x + pad, y + pad, SQ - pad * 2, SQ - pad * 2);
  ctx.restore();
}

interface Frame {
  game: Game;
  /** A piece in flight: drawn at a point between two squares, and hidden from its source. */
  moving?: { move: MoveInput; t: number };
  /** Ending overlay. */
  banner?: GifRequest;
  /** Horizontal slices shifted sideways: a glitch. */
  glitch?: number;
}

function drawFrame(ctx: CanvasRenderingContext2D, f: Frame, req: GifRequest, label: string) {
  const { game, moving } = f;
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Header: the name, with a little chromatic split.
  ctx.font = '700 22px "Chakra Petch", sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.pink;
  ctx.fillText("QUICK CHESS", 16 + 2, HEADER / 2);
  ctx.fillStyle = COLORS.text;
  ctx.fillText("QUICK CHESS", 16, HEADER / 2);
  ctx.font = '500 14px "JetBrains Mono", monospace';
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "right";
  ctx.fillText(label, WIDTH - 16, HEADER / 2);
  ctx.textAlign = "left";

  // Board.
  const last = moving ? moving.move : game.lastMove();
  for (const sq of ALL_SQUARES) {
    const [x, y] = squareXY(sq, req.orientation);
    ctx.fillStyle = isLightSquare(sq) ? COLORS.light : COLORS.dark;
    ctx.fillRect(x, y, SQ, SQ);
    if (last && (sq === last.from || sq === last.to)) {
      ctx.fillStyle = COLORS.last;
      ctx.fillRect(x, y, SQ, SQ);
      ctx.strokeStyle = COLORS.cyan;
      ctx.lineWidth = 3;
      const c = SQ * 0.26;
      ctx.beginPath();
      for (const [cx, cy, dx, dy] of [
        [x, y, 1, 1],
        [x + SQ, y, -1, 1],
        [x, y + SQ, 1, -1],
        [x + SQ, y + SQ, -1, -1],
      ] as const) {
        ctx.moveTo(cx + dx * 1.5, cy + dy * c);
        ctx.lineTo(cx + dx * 1.5, cy + dy * 1.5);
        ctx.lineTo(cx + dx * c, cy + dy * 1.5);
      }
      ctx.stroke();
    }
  }
  const checked = !moving ? game.checkedKing() : null;
  if (checked) {
    const [x, y] = squareXY(checked, req.orientation);
    const tone = f.banner ? TONE_COLOR[req.tone] : "#ff4d5e";
    const g = ctx.createRadialGradient(x + SQ / 2, y + SQ / 2, 2, x + SQ / 2, y + SQ / 2, SQ * 0.6);
    g.addColorStop(0, tone);
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(x, y, SQ, SQ);
  }
  for (const sq of ALL_SQUARES) {
    const p = game.pieceAt(sq);
    if (!p || (moving && sq === moving.move.from)) continue;
    const [x, y] = squareXY(sq, req.orientation);
    drawPiece(ctx, p.type, p.color, x, y);
  }
  if (moving) {
    const p = game.pieceAt(moving.move.from);
    if (p) {
      const [x1, y1] = squareXY(moving.move.from, req.orientation);
      const [x2, y2] = squareXY(moving.move.to, req.orientation);
      const e = 1 - Math.pow(1 - moving.t, 3);
      drawPiece(ctx, p.type, p.color, x1 + (x2 - x1) * e, y1 + (y2 - y1) * e);
    }
  }

  // Footer: the last move in notation.
  const san = game.san();
  ctx.font = '500 15px "JetBrains Mono", monospace';
  ctx.fillStyle = COLORS.muted;
  if (san.length && !moving) {
    const n = Math.ceil(san.length / 2);
    const prefix = san.length % 2 === 1 ? `${n}.` : `${n}...`;
    ctx.fillText(`${prefix} ${san[san.length - 1]}`, 16, HEADER + SIZE + FOOTER / 2);
  }
  ctx.textAlign = "right";
  ctx.fillText("jayfox.design", WIDTH - 16, HEADER + SIZE + FOOTER / 2);
  ctx.textAlign = "left";

  if (f.glitch) glitchSlices(ctx, f.glitch);
  if (f.banner) drawBanner(ctx, f.banner);
}

/** Cut a few horizontal strips and shove them sideways. Seeded so the GIF is repeatable. */
function glitchSlices(ctx: CanvasRenderingContext2D, seed: number) {
  let s = seed * 9301 + 49297;
  const rand = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 7; i++) {
    const y = HEADER + Math.floor(rand() * SIZE);
    const h = 4 + Math.floor(rand() * 22);
    const dx = Math.round((rand() - 0.5) * 48);
    const strip = ctx.getImageData(0, y, WIDTH, h);
    ctx.putImageData(strip, dx, y);
  }
}

function drawBanner(ctx: CanvasRenderingContext2D, req: GifRequest) {
  ctx.fillStyle = "rgba(11, 7, 22, 0.72)";
  ctx.fillRect(0, HEADER, WIDTH, SIZE);
  const tone = TONE_COLOR[req.tone];
  const cy = HEADER + SIZE / 2;
  ctx.font = '700 64px "Chakra Petch", sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.cyan;
  ctx.fillText(req.banner, WIDTH / 2 - 3, cy - 10);
  ctx.fillStyle = COLORS.pink;
  ctx.fillText(req.banner, WIDTH / 2 + 3, cy - 10);
  ctx.save();
  ctx.shadowColor = tone;
  ctx.shadowBlur = 24;
  ctx.fillStyle = tone;
  ctx.fillText(req.banner, WIDTH / 2, cy - 10);
  ctx.restore();
  ctx.font = '500 17px "JetBrains Mono", monospace';
  ctx.fillStyle = COLORS.text;
  ctx.fillText(req.subtitle, WIDTH / 2, cy + 44);
  ctx.textAlign = "left";
}

/** Builds the GIF in the browser. Returns the file's bytes. */
export async function makeGameGif(req: GifRequest): Promise<Uint8Array> {
  await loadAllPieces();
  try {
    await Promise.all([
      document.fonts?.load('700 64px "Chakra Petch"'),
      document.fonts?.load('500 15px "JetBrains Mono"'),
    ]);
  } catch {
    // fonts are a nicety; the GIF falls back to system fonts
  }
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No canvas");

  const first = replayStart(req.moves.length);
  const frames: { frame: Frame; delay: number; label: string }[] = [];
  const total = Math.ceil(req.moves.length / 2);
  let game = new Game(req.moves.slice(0, first));
  frames.push({ frame: { game }, delay: 700, label: "replay" });
  for (let i = first; i < req.moves.length; i++) {
    const move = fromUci(req.moves[i]!);
    const label = `move ${Math.floor(i / 2) + 1} / ${total}`;
    for (const t of [0.34, 0.67])
      frames.push({ frame: { game, moving: { move, t } }, delay: 50, label });
    game = game.play(move) ?? game;
    frames.push({ frame: { game }, delay: i === req.moves.length - 1 ? 900 : 520, label });
  }
  const endLabel = "game over";
  frames.push({ frame: { game, glitch: 1 }, delay: 80, label: endLabel });
  frames.push({ frame: { game, glitch: 2 }, delay: 80, label: endLabel });
  frames.push({ frame: { game, banner: req, glitch: 3 }, delay: 90, label: endLabel });
  frames.push({ frame: { game, banner: req }, delay: 3200, label: endLabel });

  const gif = GIFEncoder();
  for (const { frame, delay, label } of frames) {
    drawFrame(ctx, frame, req, label);
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const palette = quantize(data, 128);
    gif.writeFrame(applyPalette(data, palette), WIDTH, HEIGHT, { palette, delay });
    // Let the page breathe between frames.
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return gif.bytes();
}

/** Shares the file where the device can (phones), and downloads it everywhere else. */
export async function shareOrDownload(
  bytes: Uint8Array,
  name: string,
): Promise<"shared" | "downloaded"> {
  const blob = new Blob([bytes], { type: "image/gif" });
  const file = new File([blob], name, { type: "image/gif" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: "Quick Chess" });
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return "downloaded";
}
