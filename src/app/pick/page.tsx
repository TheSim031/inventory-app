import { redirect } from 'next/navigation';

/** Legacy path — pick UI lives at /out */
export default function PickRedirectPage() {
  redirect('/out');
}
