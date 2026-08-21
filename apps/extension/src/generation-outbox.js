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
  const initialCallFrontier = callFrontier;
  let lastDeliveredCall;
  let openLifecycleCall;
  let openLifecycleAcceptedCount = 0;
  const replayedAutomaticRetryCalls = new Set();
  let completedResult;
  const ordered = [...entries].sort(
    (left, right) => Number(left.sequence) - Number(right.sequence),
  );
  const rebaseFirstBufferedCall = (event) => {
    const shouldRebase =
      event.callIndex === initialCallFrontier &&
      event.startIndex === recovered.continuation.startIndex &&
      recovered.continuation.previousOutcome &&
      (Number(recovered.continuation.nextOrdinalAttempt ?? 1) > 1 ||
        recovered.continuation.retryOrdinals?.includes(event.startIndex + 1));
    if (!shouldRebase) return event;
    return {
      ...event,
      classification: "automatic_retry",
      ordinalAttempt: Math.max(
        2,
        Number(recovered.continuation.nextOrdinalAttempt ?? 2),
      ),
      retryKind: recovered.continuation.retryKind ?? "automatic_resume",
    };
  };
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
      if (
        openLifecycleCall &&
        chunk.startIndex === openLifecycleCall.startIndex
      ) {
        openLifecycleAcceptedCount = 1;
      }
      questionFrontier += 1;
      continue;
    }
    if (message?.type === "call") {
      const event = message.event;
      if (!Number.isInteger(event?.callIndex)) continue;
      if (event.callIndex < callFrontier) continue;
      if (event.callIndex !== callFrontier) break;
      const replayedEvent = rebaseFirstBufferedCall({
        ...event,
        recoverySessionId: context.recoverySessionId,
      });
      if (replayedEvent.lifecycleState === "started") {
        if (openLifecycleCall?.callIndex === replayedEvent.callIndex) continue;
        openLifecycleCall = replayedEvent;
        openLifecycleAcceptedCount = 0;
        post({ ...message, requestId, event: replayedEvent });
        if (replayedEvent.classification === "automatic_retry") {
          replayedAutomaticRetryCalls.add(replayedEvent.callIndex);
        }
        continue;
      }
      if (
        replayedEvent.lifecycleState !== undefined &&
        openLifecycleCall?.callIndex !== replayedEvent.callIndex
      ) {
        break;
      }
      post({ ...message, requestId, event: replayedEvent });
      callFrontier += 1;
      lastDeliveredCall = replayedEvent;
      if (replayedEvent.classification === "automatic_retry") {
        replayedAutomaticRetryCalls.add(replayedEvent.callIndex);
      }
      openLifecycleCall = undefined;
      openLifecycleAcceptedCount = 0;
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

  if (openLifecycleCall) {
    const acceptedCount = openLifecycleAcceptedCount;
    const terminalEvent = {
      ...openLifecycleCall,
      lifecycleState: acceptedCount === 1 ? "completed" : "abandoned",
      acceptedCount,
      outcome: acceptedCount === 1 ? "complete" : "network_interrupted",
      retryDelayMs: 0,
      elapsedMs: 0,
      usageComplete: false,
    };
    post({
      type: "call",
      requestId,
      event: terminalEvent,
    });
    callFrontier += 1;
    lastDeliveredCall = terminalEvent;
    openLifecycleCall = undefined;
  }

  recovered.continuation.startIndex = questionFrontier;
  recovered.continuation.nextCallIndex = callFrontier;
  recovered.continuation.automaticRetryCount = Math.min(
    12,
    (recovered.continuation.automaticRetryCount ?? 0) +
      replayedAutomaticRetryCalls.size,
  );
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
