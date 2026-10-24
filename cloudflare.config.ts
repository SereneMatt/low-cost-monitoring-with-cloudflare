import { bindings, defineConfig, triggers } from "cf/config";

const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://my_cool_app.com";
const databaseId = process.env.D1_DATABASE_ID || "REPLACE_WITH_D1_DATABASE_ID";

export default defineConfig({
	worker: {
		name: "form-monitor",
		compatibilityDate: "2026-07-30",
		entrypoint: "src/worker.js",
		triggers: [
			triggers.scheduled({
				schedule: "*/5 * * * *",
			}),
		],
		env: {
			ALLOWED_ORIGIN: bindings.text(allowedOrigin),
			ALERT_THRESHOLD: bindings.text("3"),
			ALERT_WINDOW_MINUTES: bindings.text("10"),
			ALERT_COOLDOWN_MINUTES: bindings.text("60"),
			RECOVERY_WINDOW_MINUTES: bindings.text("15"),
			MAX_EVENTS_PER_CLIENT_PER_HOUR: bindings.text("30"),
			SLACK_WEBHOOK_URL: bindings.secret(),
			RATE_LIMIT_SALT: bindings.secret(),
			DB: bindings.d1({
				name: "form-monitor",
				id: databaseId,
			}),
		},
	},
});
