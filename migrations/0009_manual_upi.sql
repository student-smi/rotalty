CREATE TABLE `payment_proofs` (
	`payment_id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`payment_id`) REFERENCES `payment_transactions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD `submitted_at` integer;--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD `provisional_until` integer;--> statement-breakpoint
ALTER TABLE `payment_transactions` ADD `reviewed_by_user_id` text REFERENCES users(id);