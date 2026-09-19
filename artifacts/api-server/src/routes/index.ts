import { Router, type IRouter } from "express";
import healthRouter from "./health";
import solanaRouter from "./solana";
import executionRouter from "./execution";
import copyTradingRouter from "./copy-trading";

const router: IRouter = Router();

router.use(healthRouter);
router.use(solanaRouter);
router.use(executionRouter);
router.use(copyTradingRouter);

export default router;
