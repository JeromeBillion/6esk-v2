import ResetPasswordClient from "./ResetPasswordClient";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  return <ResetPasswordClient token={params?.token} />;
}
