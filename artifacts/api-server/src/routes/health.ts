import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    rpc:
      process.env.SOLANA_RPC_URL ??
      "https://api.mainnet-beta.solana.com",
    jupiterConfigured: Boolean(process.env.JUPITER_API_KEY),
  });
  res.json(data);
});

export default router;
