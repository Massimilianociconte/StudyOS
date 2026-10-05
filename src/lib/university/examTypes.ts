import type { BarbCourse } from "./types";

export interface BarbExamSourceReference {
  sourceUrl: string;
  officialId: string | null;
  sourceCourseCode: string | null;
  sourceCourseName: string;
  degreeCode: string | null;
  registrationOpens: string | null;
  registrationCloses: string | null;
  /** Complete published enrolment record, including notices and surname ranges. */
  sourceRecord: Record<string, unknown>;
  lastVerifiedAt?: string;
  /** Previously observed enrolment absent from the latest complete feeds. */
  historical?: boolean;
}

export interface BarbExamSession {
  id: string;
  courseId: string;
  date: string;
  type: string | null;
  time: string | null;
  location: string | null;
  notes: string | null;
  registrationOpens: string | null;
  registrationCloses: string | null;
  officialId?: string | null;
  canonicalOfficialId?: string | null;
  commission?: string | null;
  sourceCourseCode?: string | null;
  /** Official component/title distinguishes different parts on the same day. */
  component?: string | null;
  aliasEvidenceUrl?: string;
  sourceReferences?: BarbExamSourceReference[];
  provenance: {
    sourceUrl: string;
    retrievedAt: string;
    lastVerifiedAt: string;
    sourcePage?: number;
  };
}

export interface BarbExamDataset {
  checkedAt: string | null;
  sessions: BarbExamSession[];
  additionalCourses: BarbCourse[];
  sources: Array<{ url: string; status: "verificato" | "non-verificato" | "non-pubblicato"; note: string }>;
  unmatched: Array<{
    courseName: string;
    courseCode: string | null;
    date: string;
    reason: string;
    sourceUrl: string;
    sourceRecord: Record<string, unknown>;
  }>;
}
