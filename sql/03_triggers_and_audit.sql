-- sql/03_triggers_and_audit.sql

-- 1. Create the trigger function
CREATE OR REPLACE FUNCTION log_wallet_balance_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Check if balance actually changed
    IF NEW.wallet_balance <> OLD.wallet_balance THEN
        INSERT INTO wallet_audit_logs (
            guest_id,
            amount_changed,
            action_type,
            balance_after
        )
        VALUES (
            NEW.id,
            ABS(NEW.wallet_balance - OLD.wallet_balance),
            CASE 
                WHEN NEW.wallet_balance > OLD.wallet_balance THEN 'CREDIT'
                ELSE 'DEBIT'
            END,
            NEW.wallet_balance
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create the trigger firing AFTER UPDATE OF wallet_balance
DROP TRIGGER IF EXISTS trigger_wallet_audit ON guests;

CREATE TRIGGER trigger_wallet_audit
AFTER UPDATE OF wallet_balance ON guests
FOR EACH ROW
EXECUTE FUNCTION log_wallet_balance_change();