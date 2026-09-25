/** A short-lived message at the bottom of the screen. */

export class Toast {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private host: HTMLElement) {}

  show(message: string, ms = 1900): void {
    this.host.textContent = message;
    this.host.classList.add('toast--show');
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.host.classList.remove('toast--show');
    }, ms);
  }
}
