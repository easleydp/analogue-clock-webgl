export class AnalogueClock {
  constructor(targetElement, options = {}) {
    if (!(targetElement instanceof HTMLElement)) {
      throw new Error(
        "Invalid targetElement provided. Must be an HTMLElement."
      );
    }
    this.targetElement = targetElement;
    this.options = options;
  }
}
