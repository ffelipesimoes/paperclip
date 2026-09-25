import { describe, expect, it } from "vitest";
import { SQUAD_TEMPLATES } from "./SquadTemplateSelector";

describe("SQUAD_TEMPLATES", () => {
  it("defines the core squads expected for onboarding: IT, Sales, Marketing and Solo", () => {
    const ids = SQUAD_TEMPLATES.map((tpl) => tpl.id);
    expect(ids).toContain("product-engineering");
    expect(ids).toContain("b2b-sales");
    expect(ids).toContain("content-machine");
    expect(ids).toContain("solo");
  });

  it("each squad defines valid agents with non-empty titles and descriptions", () => {
    for (const tpl of SQUAD_TEMPLATES) {
      expect(tpl.agents.length).toBeGreaterThan(0);
      expect(tpl.name.trim().length).toBeGreaterThan(0);
      expect(tpl.tagline.trim().length).toBeGreaterThan(0);
      expect(tpl.description.trim().length).toBeGreaterThan(0);
      expect(tpl.starterProjectName.trim().length).toBeGreaterThan(0);

      for (const agent of tpl.agents) {
        expect(agent.slug.trim().length).toBeGreaterThan(0);
        expect(agent.name.trim().length).toBeGreaterThan(0);
        expect(agent.title.trim().length).toBeGreaterThan(0);
        expect(agent.roleLabel.trim().length).toBeGreaterThan(0);
        expect(agent.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("bundled catalog squads have matching catalog slugs", () => {
    const itSquad = SQUAD_TEMPLATES.find((tpl) => tpl.id === "product-engineering");
    expect(itSquad?.catalogSlug).toBe("product-engineering");
    expect(itSquad?.agentCount).toBe(3);

    const salesSquad = SQUAD_TEMPLATES.find((tpl) => tpl.id === "b2b-sales");
    expect(salesSquad?.catalogSlug).toBe("b2b-sales");
    expect(salesSquad?.agentCount).toBe(2);

    const marketingSquad = SQUAD_TEMPLATES.find((tpl) => tpl.id === "content-machine");
    expect(marketingSquad?.catalogSlug).toBe("content-machine");
    expect(marketingSquad?.agentCount).toBe(2);

    const solo = SQUAD_TEMPLATES.find((tpl) => tpl.id === "solo");
    expect(solo?.catalogSlug).toBeNull();
    expect(solo?.agentCount).toBe(1);
  });
});
