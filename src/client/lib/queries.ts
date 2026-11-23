import { useQuery } from "@tanstack/react-query";
import { api, type BusinessResponse, type Me } from "./api";

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me") });

export const useBusiness = (businessId: string) =>
  useQuery({ queryKey: ["business", businessId], queryFn: () => api<BusinessResponse>(`/api/businesses/${businessId}`) });
