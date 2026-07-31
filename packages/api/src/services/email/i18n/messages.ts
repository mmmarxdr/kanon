/**
 * Email i18n dictionaries (KAN-203 Slice 2 — instance email locale).
 *
 * ONLY the instance admin's `InstanceSettings.defaultLocale` selects the
 * language of outbound transactional emails — there is no Accept-Language
 * negotiation and no per-user locale here. See getInstanceLocale() in
 * modules/instance/service.ts.
 *
 * Builders call emailT(locale, key, vars) to look up copy. Missing keys and
 * unrecognized/omitted locales fall back to English so existing unit tests
 * (which call build*Email without a locale) keep passing unchanged.
 */

export type EmailLocale = "en" | "es";

export const DEFAULT_EMAIL_LOCALE: EmailLocale = "en";

type MessageLeaf = string;
type MessageNode = MessageLeaf | { [key: string]: MessageNode };
type MessageTree = { [key: string]: MessageNode };

const en = {
  verify: {
    subject: "Verify your email",
    eyebrow: "Step 1 of 2 — verify",
    heading: "Confirm your email, then we\u2019ll spin up your workspace.",
    bodyIntro: "Thanks for signing up. Click below to verify this address.",
    bodyExpiry: "The link is good for <strong>24 hours</strong> and only works once.",
    whatsNextLabel: "What\u2019s next",
    step1Title: "Connect your repo",
    step1Desc: "GitHub, GitLab, or self-hosted. Read-only by default.",
    step2Title: "Plug in MCP",
    step2Desc: "Claude reads your roadmap and writes back via MCP. No keys to manage.",
    step3Title: "Invite your team",
    step3Desc: "Roles map to SAML groups if you have SSO.",
    ctaLabel: "Verify email →",
    disclaimer:
      "Didn\u2019t sign up? You can ignore this — the email won\u2019t be activated. We never share your address.",
    textTitle: "Step 1 of 2 — Verify your email",
    textBody1: "Thanks for signing up. Click below to verify this address.",
    textBody2: "The link is good for 24 hours and only works once.",
    textCta: "Verify your email:",
    textWhatsNext: "What's next:",
    textStep1: "01  Connect your repo — GitHub, GitLab, or self-hosted.",
    textStep2: "02  Plug in MCP — Claude reads your roadmap via MCP.",
    textStep3: "03  Invite your team — Roles map to SAML groups if you have SSO.",
    textDisclaimer: "Didn't sign up? You can ignore this email.",
  },
  reset: {
    subject: "Reset your password",
    eyebrow: "Password reset · 1 hour",
    heading: "Reset your password.",
    body1:
      "Someone asked to reset the password for this account. If that wasn\u2019t you, ignore this — your password stays as it is.",
    body2:
      'The link expires <strong style="color:#3A3D40;">1 hour</strong> from request. If it\u2019s stale, just request a new one.',
    safetyLabel: "Account safety",
    tip1: "Use a passphrase, not a single word.",
    tip2: "Turn on 2FA — Settings → Security.",
    tip3: "Revoke any session that wasn\u2019t yours.",
    helpText: "Need help? Reply to this email — a human will get back to you.",
    ctaLabel: "Choose a new password →",
    disclaimer:
      "If you didn\u2019t request a password reset, no action is needed. Your password has not been changed.",
    textTitle: "Password reset",
    textBody1: "Someone asked to reset the password for this account.",
    textBody2: "If that wasn't you, ignore this — your password stays as it is.",
    textCta: "Reset your password:",
    textExpiry: "This link expires in 1 hour.",
    textTipsLabel: "Account safety tips:",
    textTip1: "- Use a passphrase, not a single word.",
    textTip2: "- Turn on 2FA — Settings → Security.",
    textTip3: "- Revoke any session that wasn't yours.",
  },
  magicLink: {
    subject: "Your Kanon sign-in link",
    eyebrow: "Magic link · 15 minutes",
    heading: "Sign in to Kanon.",
    body1:
      "Click the button below to sign in to Kanon. No password needed. If you didn\u2019t request this, you can safely ignore this email.",
    body2: 'The link expires <strong style="color:#3A3D40;">15 minutes</strong> from request.',
    ctaLabel: "Sign in →",
    disclaimer:
      "If you didn\u2019t request a sign-in link, no action is needed. This link will expire shortly.",
    textTitle: "Kanon sign-in link",
    textBody1: "Click the link below to sign in. No password needed.",
    textBody2: "If you didn't request this, ignore this email.",
    textCta: "Sign in:",
    textExpiry: "This link expires in 15 minutes.",
  },
  invite: {
    subject: "You've been invited to join {{workspace}} on Kanon",
    eyebrow: "Invitation · {{workspace}}",
    heading: "{{inviter}} invited you to Kanon · {{workspace}}.",
    bodyIntro:
      'You\u2019ve been invited to join <strong style="color:#0E1011;">{{workspace}}</strong> as a&#32;<span style="font-family:\'Courier New\',Courier,monospace;padding:1px 6px;border:1px solid #D5D5D0;border-radius:3px;font-size:12px;color:#3A3D40;">{{role}}</span>.',
    bodyExpiry: 'This invite expires on <strong style="color:#3A3D40;">{{date}}</strong>.',
    ctaLabel: "Accept invitation →",
    disclaimer: "If you didn\u2019t expect this invitation, you can safely ignore this email.",
    textSubjectLine: "Invitation to {{workspace}} on Kanon",
    textBody: "{{inviter}} has invited you to join {{workspace}} as a {{role}}.",
    textCta: "Accept the invite:",
    textExpiry: "This invite expires on {{date}}.",
  },
  assignment: {
    subject: "You've been assigned to {{issueKey}}",
    eyebrow: "Assignment · {{issueKey}}",
    heading: "{{assignedByName}} assigned you an issue.",
    bodyHtml:
      '<strong style="color:#0E1011;">{{assignedByName}}</strong> assigned you to <strong style="color:#0E1011;">{{issueKey}}</strong> — {{issueTitle}}.',
    ctaLabel: "View issue →",
    disclaimer:
      'You received this because an issue was assigned to you. <a href="{{appUrl}}/settings/notifications" style="color:#71757A;">Manage notifications</a>.',
    textLine1: "{{assignedByName}} assigned you to {{issueKey}} — {{issueTitle}}",
    textCta: "View the issue:",
    textManage: "Manage notifications: {{appUrl}}/settings/notifications",
  },
  mention: {
    subject: "{{mentionedByName}} mentioned you in {{issueKey}}",
    eyebrow: "Mention · {{issueKey}}",
    heading: "{{mentionedByName}} mentioned you.",
    bodyHtml:
      '<strong style="color:#0E1011;">{{mentionedByName}}</strong> mentioned you in <strong style="color:#0E1011;">{{issueKey}}</strong> — {{issueTitle}}.',
    ctaLabel: "View issue →",
    disclaimer:
      'You received this because you were mentioned. <a href="{{appUrl}}/settings/notifications" style="color:#71757A;">Manage notifications</a>.',
    textLine1: "{{mentionedByName}} mentioned you in {{issueKey}} — {{issueTitle}}",
    textCta: "View the issue:",
    textManage: "Manage notifications: {{appUrl}}/settings/notifications",
  },
  cycleClosed: {
    subject: "Cycle closed: {{cycleName}}",
    eyebrow: "Cycle closed · {{projectKey}}",
    heading: "{{cycleName}} is complete.",
    bodyIntro:
      'The cycle <strong style="color:#0E1011;">{{cycleName}}</strong> in <strong style="color:#0E1011;">{{projectName}}</strong> ({{projectKey}}) has been closed.',
    statVelocityLabel: "Velocity (story points)",
    statCompletedLabel: "Issues completed",
    statScopeLabel: "Scope changes",
    ctaLabel: "View project →",
    disclaimer:
      'You received this cycle report as a project member. <a href="{{appUrl}}/settings/notifications" style="color:#71757A;">Manage notifications</a>.',
    textTitle: "Cycle closed: {{cycleName}} — {{projectName}} ({{projectKey}})",
    textVelocity: "Velocity: {{velocity}} story points",
    textCompleted: "Issues completed: {{completed}} of {{planned}} ({{rate}}%)",
    textScopeChanges: "Scope changes: +{{added}} added / -{{removed}} removed",
    textViewProject: "View project: {{appUrl}}",
    textManage: "Manage notifications: {{appUrl}}/settings/notifications",
  },
} as const satisfies MessageTree;

const es = {
  verify: {
    subject: "Verifica tu correo electrónico",
    eyebrow: "Paso 1 de 2 — verificación",
    heading: "Confirma tu correo y pondremos en marcha tu espacio de trabajo.",
    bodyIntro: "Gracias por registrarte. Haz clic abajo para verificar esta dirección.",
    bodyExpiry: "El enlace es válido durante <strong>24 horas</strong> y solo funciona una vez.",
    whatsNextLabel: "Próximos pasos",
    step1Title: "Conecta tu repositorio",
    step1Desc: "GitHub, GitLab o autoalojado. Solo lectura de forma predeterminada.",
    step2Title: "Activa el MCP",
    step2Desc:
      "Claude lee tu hoja de ruta y escribe cambios a través de MCP. Sin claves que gestionar.",
    step3Title: "Invita a tu equipo",
    step3Desc: "Los roles se asignan a grupos SAML si usas SSO.",
    ctaLabel: "Verificar correo →",
    disclaimer:
      "¿No te registraste? Puedes ignorar esto — el correo no se activará. Nunca compartimos tu dirección.",
    textTitle: "Paso 1 de 2 — Verifica tu correo",
    textBody1: "Gracias por registrarte. Haz clic abajo para verificar esta dirección.",
    textBody2: "El enlace es válido durante 24 horas y solo funciona una vez.",
    textCta: "Verifica tu correo:",
    textWhatsNext: "Próximos pasos:",
    textStep1: "01  Conecta tu repositorio — GitHub, GitLab o autoalojado.",
    textStep2: "02  Activa el MCP — Claude lee tu hoja de ruta vía MCP.",
    textStep3: "03  Invita a tu equipo — Los roles se asignan a grupos SAML si usas SSO.",
    textDisclaimer: "¿No te registraste? Puedes ignorar este correo.",
  },
  reset: {
    subject: "Restablece tu contraseña",
    eyebrow: "Restablecer contraseña · 1 hora",
    heading: "Restablece tu contraseña.",
    body1:
      "Alguien solicitó restablecer la contraseña de esta cuenta. Si no fuiste tú, ignora este mensaje — tu contraseña seguirá igual.",
    body2:
      'El enlace caduca en <strong style="color:#3A3D40;">1 hora</strong> desde la solicitud. Si ya venció, simplemente solicita uno nuevo.',
    safetyLabel: "Seguridad de la cuenta",
    tip1: "Usa una frase de contraseña, no una sola palabra.",
    tip2: "Activa la verificación en dos pasos — Ajustes → Seguridad.",
    tip3: "Revoca cualquier sesión que no reconozcas.",
    helpText: "¿Necesitas ayuda? Responde a este correo — una persona te atenderá.",
    ctaLabel: "Elegir nueva contraseña →",
    disclaimer:
      "Si no solicitaste restablecer tu contraseña, no es necesario hacer nada. Tu contraseña no ha cambiado.",
    textTitle: "Restablecimiento de contraseña",
    textBody1: "Alguien solicitó restablecer la contraseña de esta cuenta.",
    textBody2: "Si no fuiste tú, ignora este mensaje — tu contraseña seguirá igual.",
    textCta: "Restablece tu contraseña:",
    textExpiry: "Este enlace caduca en 1 hora.",
    textTipsLabel: "Consejos de seguridad de la cuenta:",
    textTip1: "- Usa una frase de contraseña, no una sola palabra.",
    textTip2: "- Activa la verificación en dos pasos — Ajustes → Seguridad.",
    textTip3: "- Revoca cualquier sesión que no reconozcas.",
  },
  magicLink: {
    subject: "Tu enlace de acceso a Kanon",
    eyebrow: "Enlace mágico · 15 minutos",
    heading: "Inicia sesión en Kanon.",
    body1:
      "Haz clic en el botón de abajo para iniciar sesión en Kanon. No necesitas contraseña. Si no solicitaste esto, puedes ignorar este correo con tranquilidad.",
    body2: 'El enlace caduca en <strong style="color:#3A3D40;">15 minutos</strong> desde la solicitud.',
    ctaLabel: "Iniciar sesión →",
    disclaimer:
      "Si no solicitaste un enlace de acceso, no es necesario hacer nada. Este enlace caducará pronto.",
    textTitle: "Enlace de acceso a Kanon",
    textBody1: "Haz clic en el enlace de abajo para iniciar sesión. No necesitas contraseña.",
    textBody2: "Si no solicitaste esto, ignora este correo.",
    textCta: "Iniciar sesión:",
    textExpiry: "Este enlace caduca en 15 minutos.",
  },
  invite: {
    subject: "Te han invitado a unirte a {{workspace}} en Kanon",
    eyebrow: "Invitación · {{workspace}}",
    heading: "{{inviter}} te invitó a Kanon · {{workspace}}.",
    bodyIntro:
      'Te han invitado a unirte a <strong style="color:#0E1011;">{{workspace}}</strong> como&#32;<span style="font-family:\'Courier New\',Courier,monospace;padding:1px 6px;border:1px solid #D5D5D0;border-radius:3px;font-size:12px;color:#3A3D40;">{{role}}</span>.',
    bodyExpiry: 'Esta invitación caduca el <strong style="color:#3A3D40;">{{date}}</strong>.',
    ctaLabel: "Aceptar invitación →",
    disclaimer: "Si no esperabas esta invitación, puedes ignorar este correo con tranquilidad.",
    textSubjectLine: "Invitación a {{workspace}} en Kanon",
    textBody: "{{inviter}} te ha invitado a unirte a {{workspace}} como {{role}}.",
    textCta: "Acepta la invitación:",
    textExpiry: "Esta invitación caduca el {{date}}.",
  },
  assignment: {
    subject: "Se te ha asignado {{issueKey}}",
    eyebrow: "Asignación · {{issueKey}}",
    heading: "{{assignedByName}} te asignó una tarea.",
    bodyHtml:
      '<strong style="color:#0E1011;">{{assignedByName}}</strong> te asignó <strong style="color:#0E1011;">{{issueKey}}</strong> — {{issueTitle}}.',
    ctaLabel: "Ver tarea →",
    disclaimer:
      'Recibiste esto porque se te asignó una tarea. <a href="{{appUrl}}/settings/notifications" style="color:#71757A;">Gestionar notificaciones</a>.',
    textLine1: "{{assignedByName}} te asignó {{issueKey}} — {{issueTitle}}",
    textCta: "Ver la tarea:",
    textManage: "Gestionar notificaciones: {{appUrl}}/settings/notifications",
  },
  mention: {
    subject: "{{mentionedByName}} te mencionó en {{issueKey}}",
    eyebrow: "Mención · {{issueKey}}",
    heading: "{{mentionedByName}} te mencionó.",
    bodyHtml:
      '<strong style="color:#0E1011;">{{mentionedByName}}</strong> te mencionó en <strong style="color:#0E1011;">{{issueKey}}</strong> — {{issueTitle}}.',
    ctaLabel: "Ver tarea →",
    disclaimer:
      'Recibiste esto porque te mencionaron. <a href="{{appUrl}}/settings/notifications" style="color:#71757A;">Gestionar notificaciones</a>.',
    textLine1: "{{mentionedByName}} te mencionó en {{issueKey}} — {{issueTitle}}",
    textCta: "Ver la tarea:",
    textManage: "Gestionar notificaciones: {{appUrl}}/settings/notifications",
  },
  cycleClosed: {
    subject: "Ciclo cerrado: {{cycleName}}",
    eyebrow: "Ciclo cerrado · {{projectKey}}",
    heading: "{{cycleName}} ha finalizado.",
    bodyIntro:
      'El ciclo <strong style="color:#0E1011;">{{cycleName}}</strong> en <strong style="color:#0E1011;">{{projectName}}</strong> ({{projectKey}}) se ha cerrado.',
    statVelocityLabel: "Velocidad (puntos de historia)",
    statCompletedLabel: "Tareas completadas",
    statScopeLabel: "Cambios de alcance",
    ctaLabel: "Ver proyecto →",
    disclaimer:
      'Recibiste este informe de ciclo por ser miembro del proyecto. <a href="{{appUrl}}/settings/notifications" style="color:#71757A;">Gestionar notificaciones</a>.',
    textTitle: "Ciclo cerrado: {{cycleName}} — {{projectName}} ({{projectKey}})",
    textVelocity: "Velocidad: {{velocity}} puntos de historia",
    textCompleted: "Tareas completadas: {{completed}} de {{planned}} ({{rate}}%)",
    textScopeChanges: "Cambios de alcance: +{{added}} añadidos / -{{removed}} eliminados",
    textViewProject: "Ver proyecto: {{appUrl}}",
    textManage: "Gestionar notificaciones: {{appUrl}}/settings/notifications",
  },
} as const satisfies MessageTree;

const dictionaries: Record<EmailLocale, MessageTree> = { en, es };

function resolveKey(tree: MessageTree, key: string): MessageLeaf | undefined {
  const parts = key.split(".");
  let node: MessageNode | undefined = tree;
  for (const part of parts) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Look up a dotted-path message key (e.g. "verify.subject") for the given
 * locale, interpolating `{{var}}` placeholders from `vars`.
 *
 * Falls back to English when:
 *  - `locale` is undefined/unrecognized, or
 *  - the key is missing from the requested locale's dictionary.
 * Falls back to the raw key string if even English is missing the key
 * (should not happen in practice — guarded by the `satisfies` shape check).
 */
export function emailT(
  locale: EmailLocale | undefined,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const loc: EmailLocale = locale === "es" ? "es" : DEFAULT_EMAIL_LOCALE;
  const value =
    resolveKey(dictionaries[loc], key) ?? resolveKey(dictionaries[DEFAULT_EMAIL_LOCALE], key) ?? key;
  return interpolate(value, vars);
}
