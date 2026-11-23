CREATE TABLE `review_keywords` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`text` text NOT NULL,
	`normalized` text NOT NULL,
	`group` text DEFAULT 'other' NOT NULL,
	`source` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_keywords_business_text_uq` ON `review_keywords` (`business_id`,`normalized`);--> statement-breakpoint
ALTER TABLE `google_review_settings` ADD `show_on_card` integer DEFAULT true NOT NULL;