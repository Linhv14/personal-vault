import { Hono } from "hono";
import type { AppBindings } from "../../types.js";
import account from "./account.js";
import login from "./login.js";
import password from "./password.js";
import recovery from "./recovery.js";
import register from "./register.js";
import sessions from "./sessions.js";

const auth = new Hono<AppBindings>();

auth.route("/", register);
auth.route("/", login);
auth.route("/", account);
auth.route("/", sessions);
auth.route("/", password);
auth.route("/", recovery);

export default auth;
