import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchemaReleasePanel } from "@/features/schema-manager/SchemaReleasePanel";

describe("SchemaReleasePanel", () => {
  it("does not render the retired Schema-only Release workflow", () => {
    const { container } = render(<SchemaReleasePanel disabled={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
