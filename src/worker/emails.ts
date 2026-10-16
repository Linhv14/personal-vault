import { APP_NAME } from "../core/brand.js";
import type { InvitableRole } from "../core/org-model.js";
import {
  formatDate,
  renderEmail,
  type EmailContext,
  type EmailLocale,
  type RenderedEmail,
} from "./email/kit.js";

export type { EmailLocale, RenderedEmail };

const STRINGS = {
  en: {
    code: {
      subject: (code: string) => `${code} is your ${APP_NAME} verification code`,
      preheader: (code: string) => `Your code is ${code}. It expires in 15 minutes.`,
      heading: "Your verification code",
      intro: `Use this code to finish creating your ${APP_NAME} vault.`,
      expiry: "It expires in 15 minutes.",
      ignore: "If you didn't request this, you can ignore this email.",
    },
    existing: {
      subject: `Your email already has a ${APP_NAME} account`,
      preheader: "Someone tried to sign up with your address. Nothing was changed.",
      heading: "You already have an account",
      intro: `Someone tried to create a ${APP_NAME} vault with this email address. Nothing was changed.`,
      next: `If this was you, open ${APP_NAME} and choose "Sign in to your vault".`,
      ignore:
        "If it wasn't you, you can ignore this email. Your vault is still protected by your master password.",
    },
    share: {
      subject: (code: string) => `${code} is your code to view a shared ${APP_NAME} login`,
      preheader: (code: string) => `Your code is ${code}. It expires in 10 minutes.`,
      heading: "Your code to view a shared login",
      intro: `Someone shared a login with you through ${APP_NAME}. Enter this code on the page you opened.`,
      expiry: "It expires in 10 minutes.",
      ignore: "If you didn't request this, you can ignore this email.",
    },
    invite: {
      subject: (org: string) => `You're invited to ${org} on ${APP_NAME}`,
      preheader: (inviter: string, org: string) => `${inviter} invited you to ${org}.`,
      heading: (org: string) => `Join ${org}`,
      intro: (inviter: string, org: string) =>
        `${inviter} invited you to ${org} on ${APP_NAME}, where teams share passwords and CI secrets, encrypted end to end.`,
      organization: "Organization",
      invitedBy: "Invited by",
      role: "Role",
      expires: "Expires",
      roles: { admin: "Admin", member: "Member" },
      accept: "Accept invitation",
      newTitle: `New to ${APP_NAME}?`,
      steps: (site: string, email: string) => [
        `Install the ${APP_NAME} extension from ${site}.`,
        `Create an account with ${email}.`,
        "Open this invitation again and accept it.",
      ],
      ignore: "If you don't know the sender, ignore this email. Nothing happens unless you accept.",
    },
  },
  vi: {
    code: {
      subject: (code: string) => `${code} là mã xác minh ${APP_NAME} của bạn`,
      preheader: (code: string) => `Mã của bạn là ${code}, hết hạn sau 15 phút.`,
      heading: "Mã xác minh của bạn",
      intro: `Dùng mã này để hoàn tất tạo vault ${APP_NAME}.`,
      expiry: "Mã hết hạn sau 15 phút.",
      ignore: "Nếu bạn không yêu cầu mã này, hãy bỏ qua email.",
    },
    existing: {
      subject: `Email của bạn đã có tài khoản ${APP_NAME}`,
      preheader: "Có người thử đăng ký bằng email của bạn. Không có gì thay đổi.",
      heading: "Email này đã có tài khoản",
      intro: `Có người vừa thử tạo vault ${APP_NAME} bằng địa chỉ email này. Không có gì thay đổi.`,
      next: `Nếu là bạn, hãy mở ${APP_NAME} và chọn "Đăng nhập vault có sẵn".`,
      ignore:
        "Nếu không phải bạn, hãy bỏ qua email này. Vault của bạn vẫn được bảo vệ bằng master password.",
    },
    share: {
      subject: (code: string) => `${code} là mã để xem tài khoản được chia sẻ qua ${APP_NAME}`,
      preheader: (code: string) => `Mã của bạn là ${code}, hết hạn sau 10 phút.`,
      heading: "Mã để xem tài khoản được chia sẻ",
      intro: `Có người đã chia sẻ một tài khoản với bạn qua ${APP_NAME}. Nhập mã này trên trang bạn đang mở.`,
      expiry: "Mã hết hạn sau 10 phút.",
      ignore: "Nếu bạn không yêu cầu mã này, hãy bỏ qua email.",
    },
    invite: {
      subject: (org: string) => `Bạn được mời vào ${org} trên ${APP_NAME}`,
      preheader: (inviter: string, org: string) => `${inviter} mời bạn vào ${org}.`,
      heading: (org: string) => `Tham gia ${org}`,
      intro: (inviter: string, org: string) =>
        `${inviter} mời bạn vào ${org} trên ${APP_NAME}, nơi các team chia sẻ mật khẩu và secret cho CI, được mã hoá đầu-cuối.`,
      organization: "Tổ chức",
      invitedBy: "Người mời",
      role: "Vai trò",
      expires: "Hết hạn",
      roles: { admin: "Quản trị", member: "Thành viên" },
      accept: "Chấp nhận lời mời",
      newTitle: `Chưa dùng ${APP_NAME}?`,
      steps: (site: string, email: string) => [
        `Cài extension ${APP_NAME} từ ${site}.`,
        `Tạo tài khoản bằng ${email}.`,
        "Mở lại lời mời này và chấp nhận.",
      ],
      ignore:
        "Nếu bạn không biết người gửi, hãy bỏ qua email này. Không có gì xảy ra nếu bạn không chấp nhận.",
    },
  },
} as const;

export function verificationCodeEmail(context: EmailContext, code: string): RenderedEmail {
  const strings = STRINGS[context.locale].code;
  return renderEmail(context, {
    subject: strings.subject(code),
    preheader: strings.preheader(code),
    heading: strings.heading,
    blocks: [
      { kind: "text", text: strings.intro },
      { kind: "code", code },
      { kind: "text", text: strings.expiry, tone: "muted" },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}

export function existingAccountEmail(context: EmailContext): RenderedEmail {
  const strings = STRINGS[context.locale].existing;
  return renderEmail(context, {
    subject: strings.subject,
    preheader: strings.preheader,
    heading: strings.heading,
    blocks: [
      { kind: "text", text: strings.intro },
      { kind: "text", text: strings.next },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}

export function shareAccessEmail(context: EmailContext, code: string): RenderedEmail {
  const strings = STRINGS[context.locale].share;
  return renderEmail(context, {
    subject: strings.subject(code),
    preheader: strings.preheader(code),
    heading: strings.heading,
    blocks: [
      { kind: "text", text: strings.intro },
      { kind: "code", code },
      { kind: "text", text: strings.expiry, tone: "muted" },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}

export interface InviteDetails {
  org: string;
  inviter: string;
  email: string;
  role: InvitableRole;
  expiresAt: number;
  link: string;
}

export function orgInviteEmail(context: EmailContext, invite: InviteDetails): RenderedEmail {
  const strings = STRINGS[context.locale].invite;
  const site = new URL(context.siteUrl).host;
  return renderEmail(context, {
    subject: strings.subject(invite.org),
    preheader: strings.preheader(invite.inviter, invite.org),
    heading: strings.heading(invite.org),
    blocks: [
      { kind: "text", text: strings.intro(invite.inviter, invite.org) },
      {
        kind: "details",
        rows: [
          [strings.organization, invite.org],
          [strings.invitedBy, invite.inviter],
          [strings.role, strings.roles[invite.role]],
          [strings.expires, formatDate(invite.expiresAt, context.locale)],
        ],
      },
      { kind: "button", label: strings.accept, href: invite.link },
      { kind: "divider" },
      { kind: "steps", title: strings.newTitle, items: strings.steps(site, invite.email) },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}
