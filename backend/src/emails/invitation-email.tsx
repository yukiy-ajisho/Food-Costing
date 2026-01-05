import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Link,
  Hr,
} from "@react-email/components";
import * as React from "react";

interface InvitationEmailProps {
  tenantName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
}

export const InvitationEmail: React.FC<InvitationEmailProps> = ({
  tenantName,
  inviterName,
  role,
  acceptUrl,
}) => {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={content}>
            <Heading style={heading}>You've been invited!</Heading>
            <Text style={paragraph}>
              <strong>{inviterName}</strong> has invited you to join{" "}
              <strong>{tenantName}</strong> on Food Costing as a{" "}
              <strong>{role}</strong>.
            </Text>
            <Text style={paragraph}>
              Click the button below to accept the invitation and get started:
            </Text>
            <Section style={buttonContainer}>
              <Button style={button} href={acceptUrl}>
                Accept Invitation
              </Button>
            </Section>
            <Text style={linkText}>
              If the button doesn't work, copy and paste this link into your
              browser:
              <br />
              <Link href={acceptUrl} style={link}>
                {acceptUrl}
              </Link>
            </Text>
          </Section>
          <Hr style={hr} />
          <Text style={footer}>
            This invitation will expire in 7 days. If you didn't expect this
            invitation, you can safely ignore this email.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

// Styles
const main = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  backgroundColor: "#ffffff",
};

const container = {
  margin: "0 auto",
  padding: "20px",
  maxWidth: "600px",
};

const content = {
  backgroundColor: "#f8f9fa",
  borderRadius: "8px",
  padding: "30px",
  marginBottom: "20px",
};

const heading = {
  color: "#2c3e50",
  fontSize: "24px",
  fontWeight: "600",
  lineHeight: "1.3",
  margin: "0 0 20px 0",
};

const paragraph = {
  fontSize: "16px",
  lineHeight: "1.6",
  color: "#333333",
  margin: "0 0 20px 0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "30px 0",
};

const button = {
  backgroundColor: "#3b82f6",
  color: "#ffffff",
  textDecoration: "none",
  padding: "12px 30px",
  borderRadius: "6px",
  fontWeight: "600",
  fontSize: "16px",
  display: "inline-block",
};

const linkText = {
  fontSize: "14px",
  color: "#6c757d",
  margin: "30px 0 0 0",
  lineHeight: "1.6",
};

const link = {
  color: "#3b82f6",
  wordBreak: "break-all" as const,
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "20px 0",
};

const footer = {
  fontSize: "12px",
  color: "#6c757d",
  textAlign: "center" as const,
  margin: "20px 0 0 0",
};

export default InvitationEmail;

