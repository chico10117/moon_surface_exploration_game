export class InputController {
  private readonly pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (event) => {
      this.pressed.add(event.code);
    });

    window.addEventListener('keyup', (event) => {
      this.pressed.delete(event.code);
    });

    window.addEventListener('blur', () => {
      this.pressed.clear();
    });
  }

  public isPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  public getAxis(negative: string, positive: string): number {
    let value = 0;
    if (this.pressed.has(negative)) {
      value -= 1;
    }
    if (this.pressed.has(positive)) {
      value += 1;
    }
    return value;
  }

  public clear(): void {
    this.pressed.clear();
  }
}
