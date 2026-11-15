import { afterEach, describe, expect, it } from "vitest";
import { chromeSlot, popupLayer } from "./overlayLayers";

afterEach(() => {
  document.getElementById("agentbuddy-chrome")?.remove();
  document.getElementById("agentbuddy-stage")?.remove();
});

describe("overlayLayers", () => {
  it("returns the stage under the menu", () => {
    const stage = document.createElement("div");
    stage.id = "agentbuddy-stage";
    document.body.appendChild(stage);

    expect(popupLayer()).toBe(stage);
  });

  it("falls back to body when the stage is absent", () => {
    expect(popupLayer()).toBe(document.body);
  });

  it("puts the chrome slot before the stage", () => {
    const stage = document.createElement("div");
    stage.id = "agentbuddy-stage";
    document.body.appendChild(stage);

    const chrome = chromeSlot();

    expect(chrome.id).toBe("agentbuddy-chrome");
    expect(chrome.nextElementSibling).toBe(stage);
    expect(chromeSlot()).toBe(chrome);
  });
});
