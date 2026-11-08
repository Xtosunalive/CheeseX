import { normalizeRelationType } from "@/lib/ontology";
import { NodeIdentity } from "./NodeIdentity";

export class RelationIdentity {
  readonly from: NodeIdentity;
  readonly to: NodeIdentity;
  readonly relationType: string;

  private constructor(from: NodeIdentity, to: NodeIdentity, relationType: string) {
    this.from = from;
    this.to = to;
    this.relationType = relationType;
    Object.freeze(this);
  }

  static create(input: { from: string | NodeIdentity; to: string | NodeIdentity; relationType: string }): RelationIdentity {
    const from = typeof input.from === "string" ? NodeIdentity.create(input.from) : input.from;
    const to = typeof input.to === "string" ? NodeIdentity.create(input.to) : input.to;
    const relationType = normalizeRelationType(input.relationType).trim();
    if (!relationType) {
      throw new Error("RelationIdentity requires a non-empty relationType");
    }
    return new RelationIdentity(from, to, relationType);
  }

  equals(other: RelationIdentity): boolean {
    return this.from.equals(other.from) && this.to.equals(other.to) && this.relationType === other.relationType;
  }

  toString(): string {
    return `${this.from.value}->${this.to.value}:${this.relationType}`;
  }

  toJSON(): { from: string; to: string; relationType: string } {
    return { from: this.from.value, to: this.to.value, relationType: this.relationType };
  }
}
