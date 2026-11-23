CREATE TABLE `wallet_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`platform` text NOT NULL,
	`object_id` text NOT NULL,
	`class_id` text NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `customer_cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_passes_card_platform_uq` ON `wallet_passes` (`card_id`,`platform`);