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
      subject: (inviter: string, org: string) =>
        `${inviter} invited you to join ${org} on ${APP_NAME}`,
      preheader: (org: string, expires: string) =>
        `Accept to get access to ${org}. The invitation expires on ${expires}.`,
      heading: (org: string) => `Join ${org} on ${APP_NAME}`,
      intro: (inviter: string, org: string, role: InvitableRole) =>
        `${inviter} has invited you to join the ${org} organization on ${APP_NAME} as ${role === "admin" ? "an admin" : "a member"}.`,
      accept: "Accept invitation",
      terms: (email: string, expires: string) =>
        `This invitation is for ${email} and expires on ${expires}. If you don't have an account yet, you'll create one when you accept.`,
      fallback: "If the button doesn't work, paste this link into your browser:",
      ignore: "If you weren't expecting this invitation, you can ignore this email.",
    },
    owner: {
      subject: (org: string) => `You're now the owner of ${org} on ${APP_NAME}`,
      preheader: (previous: string) => `${previous} transferred ownership to you.`,
      heading: (org: string) => `You own ${org} now`,
      intro: (previous: string, org: string) =>
        `${previous} transferred ownership of ${org} to you. They are now an admin.`,
      rights:
        "As the owner you can change roles, set the allowed email domains and transfer ownership again.",
      open: "Open organization settings",
      ignore: (previous: string) =>
        `If you didn't expect this, contact ${previous} or your organization's admins.`,
    },
    recovered: {
      subject: `Your ${APP_NAME} master password was reset with your recovery code`,
      preheader: "Your recovery code was used and replaced. Every device was signed out.",
      heading: "Your master password was reset",
      intro: `Someone used your recovery code to set a new master password for your ${APP_NAME} vault. Every device was signed out and the old recovery code no longer works.`,
      next: "If this was you, keep the new recovery code you were shown somewhere safe.",
      ignore:
        "If it wasn't you, someone has your recovery code. Sign in with your new master password if you can, and contact support right away.",
    },
    recoveryCode: {
      subject: (code: string) => `${code} is your code to reset your ${APP_NAME} master password`,
      preheader: (code: string) => `Your code is ${code}. It expires in 15 minutes.`,
      heading: "Reset your master password",
      intro: `Someone entered your recovery code to set a new master password for your ${APP_NAME} vault. Enter this code to continue.`,
      expiry: "It expires in 15 minutes.",
      ignore:
        "If this wasn't you, don't share this code. Someone has your recovery code: sign in and replace it under Settings → Security.",
    },
    newSignIn: {
      subject: `New sign-in to your ${APP_NAME} vault`,
      preheader: (device: string) => `Your vault was opened from ${device}.`,
      heading: "New sign-in",
      intro: (device: string, date: string) =>
        `Your ${APP_NAME} vault was opened from a device it hasn't seen before: ${device}, on ${date}.`,
      next: "If this was you, there's nothing to do.",
      ignore:
        "If it wasn't you, change your master password right away and sign out the other devices under Settings → Account.",
      unknown: "an unrecognized device",
    },
    twoFactorOn: {
      subject: `Two-factor authentication is on for your ${APP_NAME} vault`,
      preheader: "Signing in now needs a code from your authenticator app.",
      heading: "Two-factor authentication is on",
      intro: `Signing in to your ${APP_NAME} vault now needs your master password and a code from your authenticator app. Every other device was signed out.`,
      ignore:
        "If this wasn't you, someone knows your master password. Change it right away and turn two-factor authentication off and on again under Settings → Security.",
    },
    twoFactorOff: {
      subject: `Two-factor authentication was turned off for your ${APP_NAME} vault`,
      preheader: "Signing in now needs only your master password.",
      heading: "Two-factor authentication is off",
      intro: `Signing in to your ${APP_NAME} vault now needs only your master password.`,
      recovered:
        "It was turned off because your recovery code was used. Turn it back on under Settings → Security.",
      ignore:
        "If this wasn't you, change your master password right away and turn two-factor authentication back on.",
    },
  },
  vi: {
    code: {
      subject: (code: string) => `${code} là mã xác minh ${APP_NAME} của bạn`,
      preheader: (code: string) => `Mã của bạn là ${code}, hết hạn sau 15 phút.`,
      heading: "Mã xác minh",
      intro: `Nhập mã này để tạo xong kho ${APP_NAME}.`,
      expiry: "Mã hết hạn sau 15 phút.",
      ignore: "Nếu bạn không yêu cầu mã này, cứ bỏ qua email.",
    },
    existing: {
      subject: `Email này đã có tài khoản ${APP_NAME}`,
      preheader: "Có người vừa thử đăng ký bằng email của bạn. Tài khoản không có gì thay đổi.",
      heading: "Email này đã có tài khoản",
      intro: `Có người vừa thử tạo kho ${APP_NAME} bằng địa chỉ email này. Tài khoản của bạn không có gì thay đổi.`,
      next: `Nếu đó là bạn, mở ${APP_NAME} và chọn "Đăng nhập kho có sẵn".`,
      ignore: "Nếu không phải bạn, cứ bỏ qua email này. Kho vẫn được bảo vệ bằng mật khẩu chính.",
    },
    share: {
      subject: (code: string) => `${code} là mã để xem tài khoản được chia sẻ qua ${APP_NAME}`,
      preheader: (code: string) => `Mã của bạn là ${code}, hết hạn sau 10 phút.`,
      heading: "Mã xem tài khoản được chia sẻ",
      intro: `Có người vừa chia sẻ một tài khoản với bạn qua ${APP_NAME}. Nhập mã này trên trang bạn đang mở.`,
      expiry: "Mã hết hạn sau 10 phút.",
      ignore: "Nếu bạn không yêu cầu mã này, cứ bỏ qua email.",
    },
    invite: {
      subject: (inviter: string, org: string) =>
        `${inviter} mời bạn tham gia ${org} trên ${APP_NAME}`,
      preheader: (org: string, expires: string) =>
        `Chấp nhận để vào ${org}. Lời mời hết hạn ngày ${expires}.`,
      heading: (org: string) => `Tham gia ${org} trên ${APP_NAME}`,
      intro: (inviter: string, org: string, role: InvitableRole) =>
        `${inviter} mời bạn vào tổ chức ${org} trên ${APP_NAME} với vai trò ${role === "admin" ? "admin" : "thành viên"}.`,
      accept: "Chấp nhận lời mời",
      terms: (email: string, expires: string) =>
        `Lời mời dành cho ${email}, hết hạn ngày ${expires}. Chưa có tài khoản thì bạn sẽ tạo luôn khi chấp nhận.`,
      fallback: "Nút không bấm được? Dán link này vào trình duyệt:",
      ignore: "Nếu bạn không biết gì về lời mời này, cứ bỏ qua email.",
    },
    owner: {
      subject: (org: string) => `Bạn đã thành chủ sở hữu ${org} trên ${APP_NAME}`,
      preheader: (previous: string) => `${previous} đã chuyển quyền sở hữu cho bạn.`,
      heading: (org: string) => `Bạn là chủ sở hữu ${org}`,
      intro: (previous: string, org: string) =>
        `${previous} đã chuyển quyền sở hữu ${org} cho bạn. Giờ họ là admin.`,
      rights:
        "Là chủ sở hữu, bạn được đổi vai trò, đặt domain email được phép và chuyển quyền sở hữu cho người khác.",
      open: "Mở cài đặt tổ chức",
      ignore: (previous: string) =>
        `Nếu bạn không biết gì về chuyện này, hãy liên hệ ${previous} hoặc admin của tổ chức.`,
    },
    recovered: {
      subject: `Mật khẩu chính ${APP_NAME} vừa được đặt lại bằng mã khôi phục`,
      preheader: "Mã khôi phục đã được dùng và thay mới. Mọi thiết bị đã bị đăng xuất.",
      heading: "Mật khẩu chính vừa được đặt lại",
      intro: `Có người vừa dùng mã khôi phục để đặt mật khẩu chính mới cho kho ${APP_NAME} của bạn. Mọi thiết bị đã bị đăng xuất và mã khôi phục cũ không còn dùng được.`,
      next: "Nếu đó là bạn, hãy cất mã khôi phục mới vừa hiện ra ở nơi an toàn.",
      ignore: "Nếu không phải bạn, có người đang giữ mã khôi phục của bạn. Liên hệ hỗ trợ ngay.",
    },
    recoveryCode: {
      subject: (code: string) => `${code} là mã để đặt lại mật khẩu chính ${APP_NAME}`,
      preheader: (code: string) => `Mã của bạn là ${code}, hết hạn sau 15 phút.`,
      heading: "Đặt lại mật khẩu chính",
      intro: `Có người vừa nhập mã khôi phục để đặt mật khẩu chính mới cho kho ${APP_NAME} của bạn. Nhập mã này để tiếp tục.`,
      expiry: "Mã hết hạn sau 15 phút.",
      ignore:
        "Nếu không phải bạn, đừng đưa mã này cho ai. Có người đang giữ mã khôi phục của bạn: hãy đăng nhập và tạo mã mới trong Cài đặt → Bảo mật.",
    },
    newSignIn: {
      subject: `Có lượt đăng nhập mới vào kho ${APP_NAME}`,
      preheader: (device: string) => `Kho của bạn vừa được mở từ ${device}.`,
      heading: "Đăng nhập mới",
      intro: (device: string, date: string) =>
        `Kho ${APP_NAME} của bạn vừa được mở từ một thiết bị chưa từng dùng trước đây: ${device}, ngày ${date}.`,
      next: "Nếu đó là bạn, bạn không cần làm gì thêm.",
      ignore:
        "Nếu không phải bạn, hãy đổi mật khẩu chính ngay và đăng xuất các thiết bị khác trong Cài đặt → Tài khoản.",
      unknown: "một thiết bị không xác định",
    },
    twoFactorOn: {
      subject: `Đã bật xác thực hai lớp cho kho ${APP_NAME}`,
      preheader: "Từ giờ đăng nhập cần thêm mã từ ứng dụng xác thực.",
      heading: "Đã bật xác thực hai lớp",
      intro: `Từ giờ đăng nhập kho ${APP_NAME} cần mật khẩu chính và mã từ ứng dụng xác thực. Mọi thiết bị khác đã bị đăng xuất.`,
      ignore:
        "Nếu không phải bạn, có người đang biết mật khẩu chính của bạn. Hãy đổi mật khẩu chính ngay, rồi tắt và bật lại xác thực hai lớp trong Cài đặt → Bảo mật.",
    },
    twoFactorOff: {
      subject: `Đã tắt xác thực hai lớp cho kho ${APP_NAME}`,
      preheader: "Từ giờ đăng nhập chỉ cần mật khẩu chính.",
      heading: "Đã tắt xác thực hai lớp",
      intro: `Từ giờ đăng nhập kho ${APP_NAME} chỉ cần mật khẩu chính.`,
      recovered:
        "Xác thực hai lớp bị tắt vì mã khôi phục vừa được dùng. Hãy bật lại trong Cài đặt → Bảo mật.",
      ignore: "Nếu không phải bạn, hãy đổi mật khẩu chính ngay và bật lại xác thực hai lớp.",
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
  const expires = formatDate(invite.expiresAt, context.locale);
  return renderEmail(context, {
    subject: strings.subject(invite.inviter, invite.org),
    preheader: strings.preheader(invite.org, expires),
    heading: strings.heading(invite.org),
    blocks: [
      { kind: "text", text: strings.intro(invite.inviter, invite.org, invite.role) },
      { kind: "button", label: strings.accept, href: invite.link },
      { kind: "text", text: strings.terms(invite.email, expires), tone: "small" },
      { kind: "divider" },
      { kind: "link", label: strings.fallback, href: invite.link },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}

export function ownershipEmail(
  context: EmailContext,
  details: { org: string; previous: string; link: string },
): RenderedEmail {
  const strings = STRINGS[context.locale].owner;
  return renderEmail(context, {
    subject: strings.subject(details.org),
    preheader: strings.preheader(details.previous),
    heading: strings.heading(details.org),
    blocks: [
      { kind: "text", text: strings.intro(details.previous, details.org) },
      { kind: "text", text: strings.rights },
      { kind: "button", label: strings.open, href: details.link },
      { kind: "text", text: strings.ignore(details.previous), tone: "small" },
    ],
  });
}

export function accountRecoveredEmail(context: EmailContext): RenderedEmail {
  const strings = STRINGS[context.locale].recovered;
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

export function recoveryCodeEmail(context: EmailContext, code: string): RenderedEmail {
  const strings = STRINGS[context.locale].recoveryCode;
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

export function newSignInEmail(
  context: EmailContext,
  details: { device: string; at: number },
): RenderedEmail {
  const strings = STRINGS[context.locale].newSignIn;
  const device = details.device || strings.unknown;
  return renderEmail(context, {
    subject: strings.subject,
    preheader: strings.preheader(device),
    heading: strings.heading,
    blocks: [
      { kind: "text", text: strings.intro(device, formatDate(details.at, context.locale)) },
      { kind: "text", text: strings.next, tone: "muted" },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}

export function twoFactorEnabledEmail(context: EmailContext): RenderedEmail {
  const strings = STRINGS[context.locale].twoFactorOn;
  return renderEmail(context, {
    subject: strings.subject,
    preheader: strings.preheader,
    heading: strings.heading,
    blocks: [
      { kind: "text", text: strings.intro },
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}

export function twoFactorDisabledEmail(
  context: EmailContext,
  { byRecovery = false }: { byRecovery?: boolean } = {},
): RenderedEmail {
  const strings = STRINGS[context.locale].twoFactorOff;
  return renderEmail(context, {
    subject: strings.subject,
    preheader: strings.preheader,
    heading: strings.heading,
    blocks: [
      { kind: "text", text: strings.intro },
      ...(byRecovery ? [{ kind: "text" as const, text: strings.recovered }] : []),
      { kind: "text", text: strings.ignore, tone: "small" },
    ],
  });
}
