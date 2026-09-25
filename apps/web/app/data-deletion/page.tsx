import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL, LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Data Deletion — CatGPT",
  description: "How to request deletion of your CatGPT account and data.",
};

const subject = "Data deletion request";
const body = [
  "Hello,",
  "",
  "I would like to request deletion of my CatGPT account and all associated data.",
  "",
  "Account email: (the email you sign in with)",
  "",
  "Thank you.",
].join("\n");
const mailto = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export default function DataDeletionPage() {
  return (
    <LegalPage
      title="Data Deletion"
      intro="You can ask us to delete your CatGPT account and the data associated with it at any time. This page explains how to make the request and what happens next."
    >
      <Section title="How to request deletion">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            Send an email to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-2">
              {CONTACT_EMAIL}
            </a>{" "}
            with the subject “{subject}”.
          </li>
          <li>
            Write from the email address you use to sign in to CatGPT, so we can verify that the
            account is yours. If you use a different address, tell us which account to delete and
            we may ask you to confirm ownership.
          </li>
          <li>We will confirm receipt and complete the deletion within 30 days.</li>
        </ol>
        <p>
          <a
            href={mailto}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Email a deletion request
          </a>
        </p>
      </Section>

      <Section title="What we delete">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Your account profile (email, name, profile picture).</li>
          <li>Your chats, generated images and text, share links, memories and preferences.</li>
          <li>Uploaded files and documents, brand profiles and their assets.</li>
          <li>
            Connected social accounts, including the encrypted access and refresh tokens we hold
            for Facebook, Instagram, X and YouTube, and records of your social posts.
          </li>
          <li>Workspaces you own, along with their content and shared accounts.</li>
        </ul>
      </Section>

      <Section title="What may remain">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Posts already published on Facebook, Instagram, X or YouTube stay on those platforms.
            Delete them there directly.
          </li>
          <li>
            Messages you sent in a workspace you did not own may remain visible to that
            workspace’s members in anonymised form.
          </li>
          <li>
            Limited records we are legally required to keep, or need to resolve disputes and
            prevent abuse, and encrypted backups, which are overwritten on a rolling basis.
          </li>
        </ul>
      </Section>

      <Section title="Delete some things yourself, right now">
        <p>You don’t need to email us to remove specific data. Inside the app you can:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>delete individual generations, chats, documents and memories;</li>
          <li>
            disconnect a social account from the sharing dialog, which deletes our stored tokens
            for it;
          </li>
          <li>
            revoke CatGPT’s access from the platform itself (Facebook and Instagram: Settings →
            Business Integrations; X: Settings → Connected apps; Google: Security → Third-party
            access).
          </li>
        </ul>
      </Section>

      <Section title="More information">
        <p>
          See our{" "}
          <Link href="/privacy" className="text-primary underline underline-offset-2">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="text-primary underline underline-offset-2">
            Terms of Service
          </Link>
          .
        </p>
      </Section>
    </LegalPage>
  );
}
