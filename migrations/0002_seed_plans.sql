-- Default plans. Limits and prices are editable by the Super Admin afterwards; code never hardcodes them.
INSERT INTO `subscription_plans` (`id`, `code`, `name`, `description`, `price_paise`, `interval_days`, `limits`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
('plan_free', 'free', 'Free', 'Get started with one shop', 0, 30,
 '{"businesses":1,"locationsPerBusiness":1,"staffPerBusiness":2,"customersPerBusiness":200,"programsPerBusiness":1,"aiGenerationsPerMonth":50,"campaignMessagesPerMonth":0,"nfc":false,"marketing":false,"advancedAnalytics":false}',
 1, 0, unixepoch() * 1000, unixepoch() * 1000),
('plan_starter', 'starter', 'Starter', 'For a growing single-outlet business', 49900, 30,
 '{"businesses":1,"locationsPerBusiness":2,"staffPerBusiness":5,"customersPerBusiness":1000,"programsPerBusiness":2,"aiGenerationsPerMonth":500,"campaignMessagesPerMonth":500,"nfc":true,"marketing":true,"advancedAnalytics":true}',
 1, 1, unixepoch() * 1000, unixepoch() * 1000),
('plan_professional', 'professional', 'Professional', 'Multiple outlets and serious retention marketing', 149900, 30,
 '{"businesses":3,"locationsPerBusiness":5,"staffPerBusiness":20,"customersPerBusiness":10000,"programsPerBusiness":5,"aiGenerationsPerMonth":3000,"campaignMessagesPerMonth":3000,"nfc":true,"marketing":true,"advancedAnalytics":true}',
 1, 2, unixepoch() * 1000, unixepoch() * 1000),
('plan_agency', 'agency', 'Agency', 'Manage many client businesses from one account', 499900, 30,
 '{"businesses":25,"locationsPerBusiness":10,"staffPerBusiness":50,"customersPerBusiness":null,"programsPerBusiness":20,"aiGenerationsPerMonth":20000,"campaignMessagesPerMonth":20000,"nfc":true,"marketing":true,"advancedAnalytics":true}',
 1, 3, unixepoch() * 1000, unixepoch() * 1000);
