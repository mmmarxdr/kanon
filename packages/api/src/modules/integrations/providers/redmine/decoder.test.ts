import { describe, expect, it } from "vitest";
import { decodeRedmineIssueDetail, decodeRedmineIssueListPage } from "./decoder.js";

const publicIssue = {
  id: 42,
  project: { id: 7, name: "Delivery" },
  tracker: { id: 1, name: "Task" },
  status: { id: 2, name: "In Progress" },
  priority: { id: 3, name: "High" },
  author: { id: 5, name: "Ada Lovelace" },
  assigned_to: { id: 6, name: "Grace Hopper" },
  subject: "Import this issue",
  description: "Visible description",
  start_date: "2026-08-01",
  due_date: "2026-08-15",
  done_ratio: 40,
  is_private: false,
  created_on: "2026-08-01T09:00:00Z",
  updated_on: "2026-08-02T10:30:00Z",
  closed_on: null,
};

describe("Redmine issue decoder", () => {
  it("decodes a list page without requiring a local Kanon issue", () => {
    const page = decodeRedmineIssueListPage(
      { issues: [publicIssue], total_count: 2, offset: 0, limit: 1 },
      "7",
      0,
      1,
    );

    expect(page).toMatchObject({
      hasMore: true,
      nextCheckpoint: {
        updatedAt: new Date("2026-08-02T10:30:00Z"),
        remoteId: "42",
        pageToken: expect.any(String),
      },
      changes: [
        {
          identity: { type: "issue", remoteId: "42", remoteProjectId: "7" },
          operation: "upsert",
          changedAt: new Date("2026-08-02T10:30:00Z"),
          createdAt: new Date("2026-08-01T09:00:00Z"),
          actor: { remoteId: "5", displayName: "Ada Lovelace" },
          fields: {
            title: "Import this issue",
            description: "Visible description",
            statusId: "2",
            priorityId: "3",
            assignee: { remoteId: "6", displayName: "Grace Hopper" },
            startDate: "2026-08-01",
            dueDate: "2026-08-15",
            progress: 40,
          },
        },
      ],
    });
    expect(page.changes[0]?.sourceVersion).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(page.changes[0]).not.toHaveProperty("closedAt");
  });

  it("binds continuation pages to stable metadata and checkpoint order", () => {
    const first = decodeRedmineIssueListPage(
      { issues: [publicIssue], total_count: 2, offset: 0, limit: 1 },
      "7",
      0,
      1,
    );
    const nextIssue = {
      ...publicIssue,
      id: 43,
      updated_on: "2026-08-02T10:31:00Z",
    };

    expect(
      decodeRedmineIssueListPage(
        { issues: [nextIssue], total_count: 2, offset: 1, limit: 1 },
        "7",
        1,
        1,
        first.nextCheckpoint,
      ),
    ).toMatchObject({
      hasMore: false,
      nextCheckpoint: {
        updatedAt: new Date("2026-08-02T10:31:00Z"),
        remoteId: "43",
        pageToken: null,
      },
    });
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [{ ...nextIssue, id: 41, updated_on: "2026-08-02T10:29:00Z" }],
          total_count: 2,
          offset: 1,
          limit: 1,
        },
        "7",
        1,
        1,
        first.nextCheckpoint,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [{ ...nextIssue, id: 42 }],
          total_count: 2,
          offset: 1,
          limit: 1,
        },
        "7",
        1,
        1,
        first.nextCheckpoint,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        { issues: [nextIssue], total_count: 3, offset: 1, limit: 1 },
        "7",
        1,
        1,
        first.nextCheckpoint,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        { issues: [nextIssue], total_count: 2, offset: 1, limit: 1 },
        "7",
        1,
        1,
      ),
    ).toThrow("Malformed Redmine issue response");
  });

  it("emits a content-free tombstone when a visible issue becomes private", () => {
    const privateIssue = {
      ...publicIssue,
      subject: "Secret subject",
      description: "Secret body",
      is_private: true,
      updated_on: "2026-08-03T10:30:00Z",
    };

    const [change] = decodeRedmineIssueListPage(
      { issues: [privateIssue], total_count: 1, offset: 0, limit: 100 },
      "7",
      0,
      100,
    ).changes;

    expect(change).toMatchObject({
      operation: "tombstone",
      fields: { reason: "private" },
    });
    expect(change).not.toHaveProperty("actor");
    expect(JSON.stringify(change)).not.toContain("Secret subject");
    expect(JSON.stringify(change)).not.toContain("Secret body");
  });

  it("decodes only public non-empty journal notes", () => {
    const detail = decodeRedmineIssueDetail(
      {
        issue: {
          ...publicIssue,
          journals: [
            {
              id: 90,
              user: { id: 8, name: "Katherine Johnson" },
              notes: "Public update",
              private_notes: false,
              created_on: "2026-08-02T10:00:00Z",
              updated_on: "2026-08-02T10:05:00Z",
              details: [],
            },
            {
              id: 91,
              user: { id: 9, name: "Private User" },
              notes: "Private update",
              private_notes: true,
              created_on: "2026-08-02T10:01:00Z",
              details: [],
            },
            {
              id: 92,
              user: { id: 8, name: "Katherine Johnson" },
              notes: "   ",
              private_notes: false,
              created_on: "2026-08-02T10:02:00Z",
              details: [{ property: "attr", name: "status_id" }],
            },
          ],
        },
      },
      "7",
    );

    expect(detail.comments).toHaveLength(2);
    expect(detail.comments[0]).toMatchObject({
      identity: {
        type: "comment",
        remoteId: "90",
        remoteProjectId: "7",
        parent: { type: "issue", remoteId: "42" },
      },
      operation: "upsert",
      changedAt: new Date("2026-08-02T10:05:00Z"),
      createdAt: new Date("2026-08-02T10:00:00Z"),
      actor: { remoteId: "8", displayName: "Katherine Johnson" },
      fields: { body: "Public update" },
    });
    expect(detail.comments[1]).toMatchObject({
      identity: { type: "comment", remoteId: "91", remoteProjectId: "7" },
      operation: "tombstone",
      fields: { reason: "private" },
    });
    expect(detail.comments[1]).not.toHaveProperty("actor");
    expect(JSON.stringify(detail)).not.toContain("Private update");
  });

  it("produces stable versions and changes them with journal revisions", () => {
    const response = {
      issue: {
        ...publicIssue,
        journals: [
          {
            id: 90,
            user: { id: 8, name: "Katherine Johnson" },
            notes: "First body",
            private_notes: false,
            created_on: "2026-08-02T10:00:00Z",
            updated_on: "2026-08-02T10:05:00Z",
            details: [],
          },
        ],
      },
    };

    const first = decodeRedmineIssueDetail(response, "7");
    const replay = decodeRedmineIssueDetail(response, "7");
    const revised = decodeRedmineIssueDetail(
      {
        issue: {
          ...response.issue,
          journals: [
            {
              ...response.issue.journals[0],
              notes: "Revised body",
              updated_on: "2026-08-02T10:06:00Z",
            },
          ],
        },
      },
      "7",
    );

    expect(replay.issue.sourceVersion).toBe(first.issue.sourceVersion);
    expect(replay.comments[0]?.sourceVersion).toBe(first.comments[0]?.sourceVersion);
    expect(revised.comments[0]?.sourceVersion).not.toBe(first.comments[0]?.sourceVersion);
  });

  it("rejects project mismatches and malformed Redmine boundaries", () => {
    expect(() =>
      decodeRedmineIssueListPage(
        { issues: [publicIssue], total_count: 1, offset: 0, limit: 100 },
        "8",
        0,
        100,
      ),
    ).toThrow("Redmine issue belongs to another project");
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [{ ...publicIssue, done_ratio: 101 }],
          total_count: 1,
          offset: 0,
          limit: 100,
        },
        "7",
        0,
        100,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueDetail({ issue: { ...publicIssue, journals: "invalid" } }, "7"),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [{ ...publicIssue, updated_on: "2026-02-30T10:00:00Z" }],
          total_count: 1,
          offset: 0,
          limit: 100,
        },
        "7",
        0,
        100,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [{ ...publicIssue, updated_on: "2026-08-02T10:30:00" }],
          total_count: 1,
          offset: 0,
          limit: 100,
        },
        "7",
        0,
        100,
      ),
    ).toThrow("Malformed Redmine issue response");
  });

  it("rejects pages whose metadata or updated_on/id order differs from the request", () => {
    expect(() =>
      decodeRedmineIssueListPage(
        { issues: [publicIssue], total_count: 2, offset: 1, limit: 1 },
        "7",
        0,
        1,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [publicIssue, { ...publicIssue, id: 41 }],
          total_count: 2,
          offset: 0,
          limit: 2,
        },
        "7",
        0,
        2,
      ),
    ).toThrow("Malformed Redmine issue response");
    expect(() =>
      decodeRedmineIssueListPage(
        {
          issues: [publicIssue, { ...publicIssue, updated_on: "2026-08-02T10:31:00Z" }],
          total_count: 2,
          offset: 0,
          limit: 2,
        },
        "7",
        0,
        2,
      ),
    ).toThrow("Malformed Redmine issue response");
  });
});
