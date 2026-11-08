export class NodeIdentity {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
    Object.freeze(this);
  }

  static create(raw: string): NodeIdentity {
    const value = raw.trim();
    if (!value) {
      throw new Error("NodeIdentity requires a non-empty id");
    }
    return new NodeIdentity(value);
  }

  equals(other: NodeIdentity): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
