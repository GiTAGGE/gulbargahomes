import { postEnquiry } from "@/lib/enquiry/http";

export async function POST(request: Request) {
  return postEnquiry(request, "owner");
}
