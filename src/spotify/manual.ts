import type { SnippetPlayer } from './snippet.ts';
import { Runner, runSnippet } from './run.ts';

/**
 * Sin Spotify: el juez pone la música por su cuenta (parlante, otra app).
 * La app solo cuenta el tiempo del fragmento para abrir los pulsadores y
 * llevar el puntaje. Sirve de respaldo si Spotify falla en plena juntada.
 */
export class ManualPlayer implements SnippetPlayer {
  readonly mode = 'manual';
  ready = true;
  deviceId = undefined;
  onStatus?: (s: string) => void;
  private runner = new Runner();

  async init() {
    this.onStatus?.('Sin reproductor: la música la ponés vos');
  }

  playSnippet(_uri: string, _startMs: number, lenMs: number) {
    const op = this.runner.begin();
    return runSnippet(() => op.sleep(lenMs));
  }

  async play() {
    this.runner.cancel();
  }

  async stop() {
    this.runner.cancel();
  }

  destroy() {
    this.runner.cancel();
  }
}
