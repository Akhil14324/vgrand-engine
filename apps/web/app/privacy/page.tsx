import type { Metadata } from "next";
import { ContactLine, LegalPage, Section } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — CatGPT",
  description: "How CatGPT collects, uses, stores and protects your information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro="This Privacy Policy explains what information CatGPT (the “Service”, “we”, “us”) collects when you use our AI chat and image studio, how we use and protect it, and the choices you have. By using the Service you agree to the practices described here."
    >
      <Section title="1. Information we collect">
        <p>
          <strong className="text-foreground">Account information.</strong> When you sign in we
          receive your email address, and where provided, your name and profile picture, through
          our authentication provider (Supabase).
        </p>
        <p>
          <strong className="text-foreground">Content you provide.</strong> Prompts, chat
          messages, uploaded images and documents (for example PDFs and Word files), brand
          profiles, workspace and team-chat messages, and the images and text the Service
          generates for you.
        </p>
        <p>
          <strong className="text-foreground">Connected social accounts.</strong> If you choose to
          connect Facebook, Instagram, X or YouTube, we receive the access needed to publish on
          your behalf: your public profile details for the connected account (name, handle,
          profile picture, account or channel identifier) and OAuth access and refresh tokens.
          We only request the permissions needed to publish the content you approve.
        </p>
        <p>
          <strong className="text-foreground">Usage and technical data.</strong> Basic logs such
          as request timestamps, IP address, browser type and error information, used to keep the
          Service secure and reliable and to enforce usage limits.
        </p>
      </Section>

      <Section title="2. How we use information">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>To provide chat, image generation, document Q&amp;A, campaigns and voice features.</li>
          <li>
            To publish content to the social accounts you connect, only when you select an account
            and press Post.
          </li>
          <li>To personalise results, for example by applying your brand profile and remembered preferences.</li>
          <li>To operate, secure, troubleshoot and improve the Service, and to prevent abuse.</li>
          <li>To communicate with you about the Service and to comply with legal obligations.</li>
        </ul>
        <p>We do not sell your personal information, and we do not use it for third-party advertising.</p>
      </Section>

      <Section title="3. Social platform data and tokens">
        <p>
          Tokens issued by Meta, X and Google are encrypted at rest using AES-256-GCM, are
          decrypted only on our servers at the moment they are needed, and are never sent to your
          browser or written to our logs. We use each platform’s data solely to connect your
          account and publish the content you approve, and to show the status of those posts.
        </p>
        <p>
          Our use and transfer of information received from Google APIs adheres to the{" "}
          <a
            className="text-primary underline underline-offset-2"
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Videos uploaded to YouTube may be restricted
          to private visibility while our Google application is unverified.
        </p>
        <p>
          You can disconnect any account at any time from the sharing dialog inside the app, which
          deletes our stored tokens for it. You can also revoke access from the platform itself
          (Facebook and Instagram: Settings → Business Integrations; X: Settings → Connected apps;
          Google: Security → Third-party access).
        </p>
      </Section>

      <Section title="4. Service providers and sharing">
        <p>We share information only with providers that help us run the Service, under their own terms and privacy commitments:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Supabase, for authentication, database and file storage.</li>
          <li>
            AI model providers such as OpenAI (and, where enabled, Black Forest Labs and Ideogram),
            which receive your prompts, reference images and document excerpts in order to
            generate a response.
          </li>
          <li>Our hosting providers (for example Railway and Vercel) and Redis for job queues.</li>
          <li>The social platforms you choose to publish to, which receive the content you approve.</li>
        </ul>
        <p>
          We may also disclose information if required by law, to protect the rights, safety or
          security of users and the Service, or in connection with a merger or acquisition.
          Workspace content, connected accounts you share with a workspace, and team chat are
          visible to that workspace’s members.
        </p>
      </Section>

      <Section title="5. Sharing links">
        <p>
          If you create a share link for a generation or conversation, anyone with the link can
          view it until you revoke it. Do not share content you want to keep private.
        </p>
      </Section>

      <Section title="6. Retention and deletion">
        <p>
          We keep your information for as long as your account is active. You can delete individual
          generations, chats, documents and connected accounts inside the app. To delete your
          account and associated data entirely, follow the steps on our{" "}
          <a className="text-primary underline underline-offset-2" href="/data-deletion">
            data deletion page
          </a>{" "}
          or contact us at <ContactLine />; we will process
          verified requests within 30 days, except where we must retain limited data to meet legal
          obligations or resolve disputes. Backups are overwritten on a rolling basis.
        </p>
        <p>
          Content already published to a third-party platform is controlled by that platform and
          must be removed there.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          We use encryption in transit (HTTPS), encryption of provider tokens at rest,
          per-user and per-workspace access controls, rate limiting and least-privilege access to
          production systems. No method of transmission or storage is completely secure, so we
          cannot guarantee absolute security.
        </p>
      </Section>

      <Section title="8. Your rights and choices">
        <p>
          Depending on where you live, you may have the right to access, correct, export or delete
          your personal information, to object to or restrict certain processing, and to withdraw
          consent. To exercise these rights, contact us at <ContactLine />. You may also lodge a
          complaint with your local data-protection authority.
        </p>
      </Section>

      <Section title="9. Cookies and local storage">
        <p>
          We use essential cookies and browser storage to keep you signed in and to remember
          interface preferences. We do not use advertising cookies.
        </p>
      </Section>

      <Section title="10. Children">
        <p>
          The Service is not directed to children under 13 (or under 16 where local law requires),
          and we do not knowingly collect their personal information. If you believe a child has
          provided us information, contact us and we will delete it.
        </p>
      </Section>

      <Section title="11. International transfers">
        <p>
          Your information may be processed in countries other than your own, including where our
          providers operate. We rely on appropriate safeguards where required by law.
        </p>
      </Section>

      <Section title="12. Changes to this policy">
        <p>
          We may update this policy from time to time. We will post the updated version here with a
          new “Last updated” date, and, for material changes, provide additional notice where
          appropriate.
        </p>
      </Section>

      <Section title="13. Contact us">
        <p>
          Questions about this policy or your data? Contact us at <ContactLine />.
        </p>
      </Section>
    </LegalPage>
  );
}
