/** The view options: layer checkboxes, orbit filter and scale mode. */

import { el } from './dom.ts';

export interface ToggleConfig {
  label: string;
  get: () => boolean;
  set: (value: boolean) => void;
}

export class TogglePanel {
  private items: Array<{ config: ToggleConfig; node: HTMLElement }> = [];
  private orbitButtons: HTMLElement[] = [];
  private scaleButtons: HTMLElement[] = [];

  head!: HTMLElement;
  body!: HTMLElement;

  constructor(
    private host: HTMLElement,
    toggles: ToggleConfig[],
    private orbits: { get: () => string; set: (mode: 'none' | 'planets' | 'all') => void },
    private scale: { get: () => string; set: (mode: 'true' | 'explore') => void },
    repoUrl?: string,
  ) {
    const title = titleRow(repoUrl);
    this.host.append(title);
    this.head = title;
    const body = el('div', 'panel__body');
    this.host.append(body);
    this.body = body;

    body.append(this.buildGrid(toggles), this.buildOrbitRow(), this.buildScaleRow());

    this.refresh();
  }

  refresh(): void {
    for (const { config, node } of this.items) {
      node.classList.toggle('toggle--on', config.get());
    }
    const orbitMode = this.orbits.get();
    const modes = ['none', 'planets', 'all'];
    this.orbitButtons.forEach((btn, i) => {
      btn.classList.toggle('btn--active', modes[i] === orbitMode);
    });
    const scaleMode = this.scale.get();
    const scaleModes = ['explore', 'true'];
    this.scaleButtons.forEach((btn, i) => {
      btn.classList.toggle('btn--active', scaleModes[i] === scaleMode);
    });
  }

  private buildGrid(toggles: ToggleConfig[]): HTMLElement {
    const grid = el('div', 'toggles__grid');
    for (const config of toggles) {
      const node = el('div', 'toggle');
      node.append(el('span', 'toggle__box'), el('span', undefined, config.label));
      node.addEventListener('click', () => {
        config.set(!config.get());
        this.refresh();
      });
      grid.append(node);
      this.items.push({ config, node });
    }
    return grid;
  }

  private buildOrbitRow(): HTMLElement {
    const orbitRow = el('div', 'segmented');
    for (const mode of ['none', 'planets', 'all'] as const) {
      const btn = el('button', 'btn', mode === 'none' ? 'no orbits' : mode);
      btn.addEventListener('click', () => {
        this.orbits.set(mode);
        this.refresh();
      });
      orbitRow.append(btn);
      this.orbitButtons.push(btn);
    }
    return orbitRow;
  }

  private buildScaleRow(): HTMLElement {
    const scaleRow = el('div', 'segmented');
    for (const mode of ['explore', 'true'] as const) {
      const btn = el('button', 'btn', mode === 'true' ? 'true scale' : 'explore scale');
      btn.title =
        mode === 'true' ? 'Everything 1:1 (T)' : 'Bodies enlarged, distances compressed (T)';
      btn.addEventListener('click', () => {
        this.scale.set(mode);
        this.refresh();
      });
      scaleRow.append(btn);
      this.scaleButtons.push(btn);
    }
    return scaleRow;
  }
}

/** The panel title, with the repository link when there is one. */
function titleRow(repoUrl: string | undefined): HTMLElement {
  const title = el('div', 'panel__title');
  title.append(el('span', undefined, 'View'));

  if (repoUrl !== undefined && repoUrl !== '') {
    const link = document.createElement('a');
    link.className = 'title-link';
    link.href = repoUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'GitHub ↗';
    link.title = 'Source, data provenance and licences';
    title.append(link);
  }
  return title;
}
