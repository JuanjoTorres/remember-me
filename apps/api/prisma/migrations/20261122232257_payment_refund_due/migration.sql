-- AlterEnum
ALTER TYPE "PaymentOrderStatus" ADD VALUE 'REFUND_DUE';

-- AlterTable
ALTER TABLE "payment_orders" ADD COLUMN     "checkout_url" TEXT;
