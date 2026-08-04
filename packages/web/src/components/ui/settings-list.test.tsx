/**
 * SettingsList layout primitive (KAN-213 Slice B + inset/responsive follow-up).
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  SettingsList,
  SettingsListRow,
  WORKSPACE_MEMBERS_GRID,
  WORKSPACE_MEMBERS_GRID_MOBILE,
  INVITES_GRID_MOBILE,
  workspaceMembersColumns,
  invitesColumns,
} from "./settings-list";

const MEMBER_COLUMNS = [
  { key: "member", label: "Member" },
  { key: "email", label: "Email", hideBelow: "sm" as const },
  { key: "joined", label: "Joined", hideBelow: "sm" as const },
  { key: "role", label: "Role" },
  { key: "actions", label: "Actions" },
];

describe("SettingsList (KAN-213 Slice B)", () => {
  it("renders a header row with localized column labels", () => {
    render(
      <SettingsList
        columns={MEMBER_COLUMNS}
        gridTemplateColumns={WORKSPACE_MEMBERS_GRID}
        mobileGridTemplateColumns={WORKSPACE_MEMBERS_GRID_MOBILE}
        data-testid="members-list"
      >
        <SettingsListRow
          columns={[
            <span key="m">Alice</span>,
            <span key="e">alice@example.com</span>,
            <span key="j">Jan 1, 2026</span>,
            <span key="r">Admin</span>,
            <button key="a" type="button">
              Remove
            </button>,
          ]}
        />
      </SettingsList>,
    );

    expect(screen.getByRole("columnheader", { name: "Member" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Email" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Joined" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Role" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
  });

  it("aligns rows to the shared grid with minimum 48px row height", () => {
    render(
      <SettingsList
        columns={MEMBER_COLUMNS}
        gridTemplateColumns={WORKSPACE_MEMBERS_GRID}
        mobileGridTemplateColumns={WORKSPACE_MEMBERS_GRID_MOBILE}
      >
        <SettingsListRow
          columns={[
            <span key="m">Bob</span>,
            <span key="e">bob@example.com</span>,
            <span key="j">Feb 2, 2026</span>,
            <span key="r">Member</span>,
            <span key="a">—</span>,
          ]}
        />
      </SettingsList>,
    );

    const header = screen.getByTestId("settings-list-header");
    expect(header).toHaveClass("settings-list-grid");
    expect(header.style.getPropertyValue("--settings-list-cols")).toBe(WORKSPACE_MEMBERS_GRID);
    expect(header.style.getPropertyValue("--settings-list-cols-mobile")).toBe(
      WORKSPACE_MEMBERS_GRID_MOBILE,
    );

    const row = screen.getByRole("row", { name: /Bob/ });
    expect(row).toHaveClass("settings-list-grid");
    expect(row).toHaveStyle({ minHeight: "48px" });
    expect(row.style.getPropertyValue("--settings-list-cols")).toBe(WORKSPACE_MEMBERS_GRID);
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
  });

  it("marks secondary columns for mobile collapse via hideBelow", () => {
    render(
      <SettingsList
        columns={MEMBER_COLUMNS}
        gridTemplateColumns={WORKSPACE_MEMBERS_GRID}
        mobileGridTemplateColumns={WORKSPACE_MEMBERS_GRID_MOBILE}
      >
        <SettingsListRow
          columns={[
            <span key="m">Carol</span>,
            <span key="e">carol@example.com</span>,
            <span key="j">Mar 3, 2026</span>,
            <span key="r">Viewer</span>,
            <span key="a">—</span>,
          ]}
        />
      </SettingsList>,
    );

    const joinedHeader = screen.getByRole("columnheader", { name: "Joined" });
    expect(joinedHeader).toHaveAttribute("data-hide-below", "sm");
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("builds workspace member columns from i18n keys", () => {
    const columns = workspaceMembersColumns((key) => {
      const labels: Record<string, string> = {
        listColMember: "Miembro",
        listColEmail: "Correo",
        listColJoined: "Se unió",
        listColRole: "Rol",
        listColActions: "Acciones",
      };
      return labels[key] ?? key;
    });

    render(
      <SettingsList
        columns={columns}
        gridTemplateColumns={WORKSPACE_MEMBERS_GRID}
        mobileGridTemplateColumns={WORKSPACE_MEMBERS_GRID_MOBILE}
      >
        <SettingsListRow
          columns={[
            <span key="m">Ana</span>,
            <span key="e">ana@test.com</span>,
            <span key="j">Apr 1</span>,
            <span key="r">Admin</span>,
            <span key="a">—</span>,
          ]}
        />
      </SettingsList>,
    );

    expect(screen.getByRole("columnheader", { name: "Miembro" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Correo" })).toBeInTheDocument();
  });

  it("omits header row when showHeader is false", () => {
    render(
      <SettingsList
        columns={[{ key: "toggle", label: "" }, { key: "label", label: "" }]}
        gridTemplateColumns="auto 1fr"
        showHeader={false}
      >
        <SettingsListRow columns={[<span key="t">switch</span>, <span key="l">Mentions</span>]} />
      </SettingsList>,
    );

    expect(screen.queryByTestId("settings-list-header")).not.toBeInTheDocument();
    expect(screen.getByText("Mentions")).toBeInTheDocument();
  });

  it("hides invite meta columns below sm and exposes a 2-track mobile grid", () => {
    const columns = invitesColumns((key) => key);
    const metaKeys = ["status", "role", "email", "uses", "expires", "createdBy"];

    for (const key of metaKeys) {
      expect(columns.find((c) => c.key === key)?.hideBelow).toBe("sm");
    }
    expect(INVITES_GRID_MOBILE.split(/\s+/).filter(Boolean)).toHaveLength(2);
    expect(WORKSPACE_MEMBERS_GRID_MOBILE.split(/\s+/).filter(Boolean)).toHaveLength(3);
  });
});
