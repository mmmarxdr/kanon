import { describe, it, expect } from "vitest";
import {
  parseFrontmatter,
  parseSkillFrontmatter,
  stripDisallowedKeys,
} from "../utils/frontmatter.js";

describe("frontmatter parser", () => {
  describe("parseFrontmatter", () => {
    it("returns empty data and full body when no frontmatter fence", () => {
      const md = "# Title\n\nNo frontmatter here.\n";
      const { body, data } = parseFrontmatter(md);
      expect(data).toEqual({});
      expect(body).toBe(md);
    });

    it("returns empty data and full body when first line is not exactly a fence", () => {
      for (const md of ["----\nbody", "---not-frontmatter\nbody"]) {
        const { body, data } = parseFrontmatter(md);
        expect(data).toEqual({});
        expect(body).toBe(md);
      }
    });

    it("parses top-level scalar key-value pairs", () => {
      const md = `---
name: foo
description: A test
version: 1.2.0
---

# Body`;
      const { body, data } = parseFrontmatter(md);
      expect(data).toEqual({
        name: "foo",
        description: "A test",
        version: "1.2.0",
      });
      expect(body.trim()).toBe("# Body");
    });

    it("parses inline flow lists into string arrays", () => {
      const md = `---
name: foo
tags: [a, b, c]
---

# Body`;
      const { data } = parseFrontmatter(md);
      expect(data["tags"]).toEqual(["a", "b", "c"]);
    });

    it("parses block sequences under a key", () => {
      const md = `---
name: foo
tools:
  - kanon_*
  - mem_save
  - mem_search
---

# Body`;
      const { data } = parseFrontmatter(md);
      expect(data["tools"]).toEqual(["kanon_*", "mem_save", "mem_search"]);
    });

    it("throws on unterminated frontmatter fence", () => {
      const md = `---
name: foo
# missing closing fence`;
      expect(() => parseFrontmatter(md)).toThrow(/Unterminated/);
    });

    it("handles Windows line endings", () => {
      const md = "---\r\nname: foo\r\ndescription: bar\r\n---\r\n\r\n# Body\r\n";
      const { data, body } = parseFrontmatter(md);
      expect(data).toEqual({ name: "foo", description: "bar" });
      expect(body).toContain("# Body");
    });

    it("coerces true/false/null/integer scalars to typed values", () => {
      const md = `---
name: foo
enabled: true
disabled: false
nothing: null
count: 42
---

body`;
      const { data } = parseFrontmatter(md);
      expect(data["enabled"]).toBe(true);
      expect(data["disabled"]).toBe(false);
      expect(data["nothing"]).toBeNull();
      expect(data["count"]).toBe(42);
    });
  });

  describe("parseSkillFrontmatter", () => {
    it("returns the data object directly", () => {
      const md = `---
name: my-skill
description: short
---

# Body`;
      expect(parseSkillFrontmatter(md)).toEqual({
        name: "my-skill",
        description: "short",
      });
    });
  });

  describe("stripDisallowedKeys", () => {
    it("removes keys not in the allowed set", () => {
      const data = {
        name: "ok",
        description: "ok",
        "allowed-tools": ["kanon_*"],
        trigger: "ok",
      };
      const allowed = new Set(["name", "description", "trigger"]);
      expect(stripDisallowedKeys(data, allowed)).toEqual({
        name: "ok",
        description: "ok",
        trigger: "ok",
      });
    });

    it("returns an empty object when nothing is allowed", () => {
      const data = { name: "x", description: "y" };
      expect(stripDisallowedKeys(data, new Set())).toEqual({});
    });
  });
});
