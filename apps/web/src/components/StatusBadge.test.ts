import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import StatusBadge from "./StatusBadge.vue";

describe("StatusBadge", () => {
  it("maps workflow states to Chinese labels", () => {
    expect(mount(StatusBadge, { props: { status: "candidate" } }).text()).toBe("待审核");
    expect(mount(StatusBadge, { props: { status: "verified" } }).text()).toBe("待发布");
    expect(mount(StatusBadge, { props: { status: "accepted" } }).text()).toBe("已执行");
    expect(mount(StatusBadge, { props: { status: "needs_evidence" } }).text()).toBe("待补证");
  });

  it("exposes the state as a class for theming", () => {
    const wrapper = mount(StatusBadge, { props: { status: "published" } });
    expect(wrapper.classes()).toContain("badge-published");
  });

  it("falls back to the raw status for unknown states", () => {
    expect(mount(StatusBadge, { props: { status: "archived" } }).text()).toBe("archived");
  });
});
