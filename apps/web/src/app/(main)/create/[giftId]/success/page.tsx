import { SuccessScreen } from './SuccessScreen';

export default async function PaymentSuccessPage({
  params,
}: {
  params: Promise<{ giftId: string }>;
}) {
  const { giftId } = await params;
  return <SuccessScreen giftId={giftId} />;
}
