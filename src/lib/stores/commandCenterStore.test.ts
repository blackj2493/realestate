import { describe, it, expect, beforeEach } from "vitest";
import { useCommandCenterStore, MAX_SELECTED } from "./commandCenterStore";

const get = () => useCommandCenterStore.getState();
const reset = () =>
  useCommandCenterStore.setState({
    selectedIds: new Set<string>(),
    selectionLimitHit: false,
    showSelectedOnly: false,
  });

describe("commandCenterStore — Compare selection cap", () => {
  beforeEach(reset);

  it("toggles ids in and out of the selection", () => {
    get().toggleSelected("A");
    expect(get().selectedIds.has("A")).toBe(true);
    get().toggleSelected("A");
    expect(get().selectedIds.has("A")).toBe(false);
  });

  it(`caps the selection at MAX_SELECTED (${MAX_SELECTED}) and flags the blocked add`, () => {
    for (let i = 0; i < MAX_SELECTED + 3; i++) get().toggleSelected(`L${i}`);
    expect(get().selectedIds.size).toBe(MAX_SELECTED);
    expect(get().selectionLimitHit).toBe(true);
    // the overflow ids were never added
    expect(get().selectedIds.has(`L${MAX_SELECTED}`)).toBe(false);
  });

  it("clears the limit flag and frees a slot when an id is removed", () => {
    for (let i = 0; i < MAX_SELECTED + 1; i++) get().toggleSelected(`L${i}`);
    expect(get().selectionLimitHit).toBe(true);
    get().toggleSelected("L0"); // remove one
    expect(get().selectionLimitHit).toBe(false);
    expect(get().selectedIds.size).toBe(MAX_SELECTED - 1);
    // now there's room again
    get().toggleSelected("NEW");
    expect(get().selectedIds.has("NEW")).toBe(true);
    expect(get().selectedIds.size).toBe(MAX_SELECTED);
  });

  it("clearSelected empties the set and resets the flag", () => {
    for (let i = 0; i < MAX_SELECTED + 1; i++) get().toggleSelected(`L${i}`);
    get().clearSelected();
    expect(get().selectedIds.size).toBe(0);
    expect(get().selectionLimitHit).toBe(false);
  });
});
