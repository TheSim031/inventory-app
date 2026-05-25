import { redirect } from 'next/navigation';

/** Legacy path — pick detail lives at /out/[id] */
export default async function PickIdRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/out/${encodeURIComponent(id)}`);
}
