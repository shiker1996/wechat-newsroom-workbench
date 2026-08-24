import { CandidateSelectionService } from '../../features/research/application/candidate-selection-service.mjs';

// 应用装配层负责把业务服务接入 Store 兼容外观；core/store 不直接知道具体 feature。
export function createCandidateSelectionService(db, repositories, candidateQueries) {
  return new CandidateSelectionService(db, repositories, candidateQueries);
}
