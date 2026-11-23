CREATE TABLE `ai_usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`feature` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_micro_usd` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`latency_ms` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ai_usage_business_created_idx` ON `ai_usage_logs` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_created_idx` ON `ai_usage_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `customer_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`program_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`points_balance` integer DEFAULT 0 NOT NULL,
	`lifetime_points` integer DEFAULT 0 NOT NULL,
	`visits` integer DEFAULT 0 NOT NULL,
	`rewards_redeemed` integer DEFAULT 0 NOT NULL,
	`last_visit_at` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `loyalty_programs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cards_points_nonneg" CHECK("customer_cards"."points_balance" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_program_customer_uq` ON `customer_cards` (`program_id`,`customer_id`);--> statement-breakpoint
CREATE INDEX `cards_business_idx` ON `customer_cards` (`business_id`);--> statement-breakpoint
CREATE INDEX `cards_customer_idx` ON `customer_cards` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customer_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`purpose` text DEFAULT 'marketing' NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`granted_at` integer,
	`withdrawn_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_business_customer_channel_uq` ON `customer_consents` (`business_id`,`customer_id`,`channel`);--> statement-breakpoint
CREATE TABLE `customer_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_sessions_token_uq` ON `customer_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `customer_sessions_customer_idx` ON `customer_sessions` (`customer_id`);--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text,
	`phone_verified` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`birthday` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_uq` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `google_review_settings` (
	`business_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`profile_name` text,
	`review_url` text,
	`category` text,
	`description` text,
	`services` text,
	`languages` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interaction_events` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`type` text NOT NULL,
	`channel` text,
	`outcome` text,
	`reason` text,
	`customer_id` text,
	`card_id` text,
	`actor_user_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_business_type_created_idx` ON `interaction_events` (`business_id`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `loyalty_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`stamp_icon` text DEFAULT 'star' NOT NULL,
	`stamps_required` integer NOT NULL,
	`min_purchase_amount` integer,
	`starts_at` integer,
	`ends_at` integer,
	`eligibility` text,
	`terms` text,
	`status` text DEFAULT 'active' NOT NULL,
	`daily_limit_per_customer` integer DEFAULT 1 NOT NULL,
	`cooldown_minutes` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `programs_business_idx` ON `loyalty_programs` (`business_id`);--> statement-breakpoint
CREATE TABLE `marketing_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`channel` text DEFAULT 'whatsapp' NOT NULL,
	`template_name` text NOT NULL,
	`template_language` text DEFAULT 'en' NOT NULL,
	`template_params` text NOT NULL,
	`audience` text NOT NULL,
	`settings` text NOT NULL,
	`scheduled_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `campaigns_business_idx` ON `marketing_campaigns` (`business_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_business_idx` ON `media` (`business_id`);--> statement-breakpoint
CREATE TABLE `nfc_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`tag_id` text,
	`location_id` text,
	`card_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`channel` text NOT NULL,
	`short_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`resolved_by_user_id` text,
	`resolved_at` integer,
	`transaction_id` text,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `nfc_tags`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `business_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `customer_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `nfc_sessions_business_status_idx` ON `nfc_sessions` (`business_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `nfc_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`location_id` text,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`replaced_by_id` text,
	`tap_count` integer DEFAULT 0 NOT NULL,
	`last_tap_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `business_locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nfc_code_uq` ON `nfc_tags` (`code`);--> statement-breakpoint
CREATE INDEX `nfc_business_idx` ON `nfc_tags` (`business_id`);--> statement-breakpoint
CREATE TABLE `notification_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`campaign_id` text,
	`customer_id` text,
	`channel` text NOT NULL,
	`recipient` text NOT NULL,
	`template_name` text NOT NULL,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`provider_message_id` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `marketing_campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notif_provider_msg_uq` ON `notification_logs` (`provider_message_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `notif_dedupe_uq` ON `notification_logs` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notif_status_next_idx` ON `notification_logs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notif_business_created_idx` ON `notification_logs` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notif_campaign_idx` ON `notification_logs` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `otp_phone_created_idx` ON `otp_codes` (`phone`,`created_at`);--> statement-breakpoint
CREATE TABLE `payment_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`provider` text DEFAULT 'razorpay' NOT NULL,
	`order_id` text NOT NULL,
	`payment_id` text,
	`amount_paise` integer NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`status` text NOT NULL,
	`failure_reason` text,
	`paid_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_order_uq` ON `payment_transactions` (`order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payment_uq` ON `payment_transactions` (`payment_id`);--> statement-breakpoint
CREATE INDEX `payments_user_idx` ON `payment_transactions` (`user_id`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by_user_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `qr_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`location_id` text,
	`code` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`scan_count` integer DEFAULT 0 NOT NULL,
	`last_scanned_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `business_locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qr_code_uq` ON `qr_codes` (`code`);--> statement-breakpoint
CREATE INDEX `qr_business_idx` ON `qr_codes` (`business_id`);--> statement-breakpoint
CREATE TABLE `review_assistant_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`language` text NOT NULL,
	`answers` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`generation_count` integer DEFAULT 1 NOT NULL,
	`redirected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_sessions_business_created_idx` ON `review_assistant_sessions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`business_id` text NOT NULL,
	`style` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `review_assistant_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `review_drafts_session_idx` ON `review_drafts` (`session_id`);--> statement-breakpoint
CREATE TABLE `reward_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`program_id` text NOT NULL,
	`card_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`reward_id` text NOT NULL,
	`reward_name` text NOT NULL,
	`points_used` integer NOT NULL,
	`actor_user_id` text,
	`location_id` text,
	`transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `loyalty_programs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `customer_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reward_id`) REFERENCES `rewards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `business_locations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transaction_id`) REFERENCES `stamp_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `redemptions_business_created_idx` ON `reward_redemptions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`program_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`points_required` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `loyalty_programs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rewards_program_idx` ON `rewards` (`program_id`);--> statement-breakpoint
CREATE TABLE `stamp_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`program_id` text NOT NULL,
	`card_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`type` text NOT NULL,
	`points` integer NOT NULL,
	`channel` text NOT NULL,
	`actor_user_id` text,
	`location_id` text,
	`nfc_tag_id` text,
	`reward_id` text,
	`idempotency_key` text NOT NULL,
	`daily_slot` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`program_id`) REFERENCES `loyalty_programs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_id`) REFERENCES `customer_cards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`location_id`) REFERENCES `business_locations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `txn_idempotency_uq` ON `stamp_transactions` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `txn_daily_slot_uq` ON `stamp_transactions` (`daily_slot`);--> statement-breakpoint
CREATE INDEX `txn_business_created_idx` ON `stamp_transactions` (`business_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `txn_card_created_idx` ON `stamp_transactions` (`card_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `subscription_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_paise` integer NOT NULL,
	`interval_days` integer DEFAULT 30 NOT NULL,
	`limits` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plans_code_uq` ON `subscription_plans` (`code`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text NOT NULL,
	`current_period_end` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_user_uq` ON `subscriptions` (`user_id`);--> statement-breakpoint
ALTER TABLE `businesses` ADD `qr_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `nfc_tag_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `businesses` ADD `nfc_phone_enabled` integer DEFAULT false NOT NULL;