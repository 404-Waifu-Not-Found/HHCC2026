function acceptedQuestionSummary(question) {
  return {
    id: question.id,
    type: question.type,
    concept: question.concept,
    question: question.question,
  };
}

export function replayGenerationOutboxEntries(
  context,
  entries,
  requestId,
  post,
) {
  const recovered = {
    ...context,
    continuation: context.continuation
      ? {
          ...context.continuation,
          acceptedQuestions: [...context.continuation.acceptedQuestions],
        }
      : undefined,
  };
  if (!recovered.continuation) return { context, completed: false };

  let questionFrontier = recovered.continuation.startIndex;
  let callFrontier = recovered.continuation.nextCallIndex ?? 0;
  let lastDeliveredCall;
  let completedResult;
  const ordered = [...entries].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  );
  for (const entry of ordered) {
    const message = entry?.message;
    if (message?.type === "question") {
      const chunk = message.result;
      if (!Number.isInteger(chunk?.startIndex)) continue;
      if (chunk.startIndex < questionFrontier) continue;
      if (chunk.startIndex !== questionFrontier) break;
      const replayed = {
        ...message,
        requestId,
        result: {
          ...chunk,
          recoverySessionId: context.recoverySessionId,
        },
      };
      post(replayed);
      recovered.continuation.acceptedQuestions.push(
        acceptedQuestionSummary(chunk.question),
      );
      questionFrontier += 1;
      continue;
    }
    if (message?.type === "call") {
      const event = message.event;
      if (!Number.isInteger(event?.callIndex)) continue;
      if (event.callIndex < callFrontier) continue;
      if (event.callIndex !== callFrontier) break;
      const replayedEvent = {
        ...event,
        recoverySessionId: context.recoverySessionId,
      };
      post({ ...message, requestId, event: replayedEvent });
      callFrontier += 1;
      lastDeliveredCall = replayedEvent;
      continue;
    }
    if (message?.type === "result" && message.response?.ok) {
      completedResult = {
        ...message,
        requestId,
        response: {
          ...message.response,
          result: {
            ...message.response.result,
            recoverySessionId: context.recoverySessionId,
          },
        },
      };
    }
  }

  recovered.continuation.startIndex = questionFrontier;
  recovered.continuation.nextCallIndex = callFrontier;
  if (
    lastDeliveredCall &&
    lastDeliveredCall.outcome !== "complete" &&
    lastDeliveredCall.acceptedCount === 0
  ) {
    recovered.continuation.nextOrdinalAttempt = Math.min(
      12,
      lastDeliveredCall.ordinalAttempt + 1,
    );
    recovered.continuation.retryKind = "automatic_resume";
    recovered.continuation.automaticRetryCount = Math.min(
      12,
      (recovered.continuation.automaticRetryCount ?? 0) +
        (lastDeliveredCall.classification === "automatic_retry" ? 1 : 0),
    );
  } else {
    recovered.continuation.nextOrdinalAttempt = 1;
    recovered.continuation.retryKind = undefined;
  }

  if (
    completedResult &&
    questionFrontier === context.questionCount &&
    callFrontier > 0
  ) {
    post(completedResult);
    return { context: recovered, completed: true };
  }
  return { context: recovered, completed: false };
}
