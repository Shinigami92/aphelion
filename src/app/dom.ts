/** DOM lookups the page shell guarantees. */

/**
 * Look up an element the page shell guarantees. The optional constructor is
 * checked with `instanceof`, so asking for a canvas cannot hand back a `div`
 * that merely claims to be one.
 */
export function need(id: string): HTMLElement;
export function need<T extends HTMLElement>(id: string, type: new () => T): T;
export function need(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const node = document.getElementById(id);
  if (!(node instanceof type)) {
    throw new Error(`missing element #${id}`);
  }
  return node;
}
