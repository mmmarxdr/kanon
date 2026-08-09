import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateProjectModal } from "@/features/projects/create-project-modal";
import { useProjectsQuery } from "@/hooks/use-projects-query";
import { fetchApi } from "@/lib/api-client";
import { projectKeys } from "@/lib/query-keys";
import type { Project } from "@/types/project";
import { SettingsCard } from "@/components/ui/settings-card";

function ProjectRow({ workspaceId, project }: { workspaceId: string; project: Project }) {
  const { t } = useTranslation("settings");
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const update = useMutation({
    mutationFn: () =>
      fetchApi<Project>(`/api/workspaces/${workspaceId}/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.list(workspaceId) }),
  });
  const archive = useMutation({
    mutationFn: () =>
      fetchApi<void>(`/api/workspaces/${workspaceId}/projects/${project.id}`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.list(workspaceId) }),
  });
  const changed = name.trim() !== project.name || description.trim() !== (project.description ?? "");

  return (
    <form
      className="space-y-4 border-t border-border py-5 first:border-t-0 first:pt-0 last:pb-0"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <code className="rounded bg-secondary px-2 py-1 text-xs font-semibold text-foreground">
          {project.key}
        </code>
        <span className="text-xs text-muted-foreground">{t("projectsKeyImmutable")}</span>
      </div>
      <label className="block text-sm font-medium text-foreground">
        {t("projectsName")}
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          required
          className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      <label className="block text-sm font-medium text-foreground">
        {t("projectsDescription")}
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </label>
      {(update.isError || archive.isError) && (
        <p className="text-sm text-destructive">{(update.error ?? archive.error)?.message}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={update.isPending || !name.trim() || !changed}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {update.isPending ? t("projectsSaving") : t("projectsSave")}
        </button>
        <button
          type="button"
          disabled={archive.isPending}
          onClick={() => {
            if (window.confirm(t("projectsArchiveConfirm", { name: project.name }))) archive.mutate();
          }}
          className="rounded-md border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive disabled:opacity-50"
        >
          {archive.isPending ? t("projectsArchiving") : t("projectsArchive")}
        </button>
      </div>
    </form>
  );
}

export function ProjectsSection({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation("settings");
  const projects = useProjectsQuery(workspaceId);
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <SettingsCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t("projectsTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("projectsHelp")}</p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="shrink-0 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {t("createProjectSubmit")}
          </button>
        </div>
        <div className="mt-5">
          {projects.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("projectsLoading")}</p>
          ) : projects.error ? (
            <p className="text-sm text-destructive">{projects.error.message}</p>
          ) : projects.data?.length ? (
            projects.data.map((project) => (
              <ProjectRow key={project.id} workspaceId={workspaceId} project={project} />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">{t("projectsEmpty")}</p>
          )}
        </div>
      </SettingsCard>
      {showCreate && (
        <CreateProjectModal workspaceId={workspaceId} onClose={() => setShowCreate(false)} />
      )}
    </>
  );
}
