function isIdentifier(node, name) {
  return node?.type === "Identifier" && (name === undefined || node.name === name);
}

function isFunctionLike(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

function isGeneratorFunctionLike(node) {
  return (
    node?.generator === true &&
    (node.type === "FunctionDeclaration" || node.type === "FunctionExpression")
  );
}

function getSingleReturnYield(node) {
  const statements = node?.body?.body;
  if (!Array.isArray(statements) || statements.length !== 1) {
    return null;
  }

  const [statement] = statements;
  if (statement?.type !== "ReturnStatement") {
    return null;
  }

  const argument = statement.argument;
  if (argument?.type !== "YieldExpression" || argument.delegate !== true || !argument.argument) {
    return null;
  }

  return argument;
}

function getWrappedCallbackBody(node) {
  if (node?.type !== "YieldExpression" || node.delegate !== true) {
    return null;
  }

  const outerCall = node.argument;
  if (outerCall?.type !== "CallExpression" || !isIdentifier(outerCall.callee, "call")) {
    return null;
  }

  const [callback] = outerCall.arguments;
  if (!isFunctionLike(callback) || callback.params.length !== 0) {
    return null;
  }

  return callback.body;
}

function getWrappedCallExpression(node) {
  const body = getWrappedCallbackBody(node);
  if (!body) {
    return null;
  }

  if (body.type === "CallExpression") {
    return body;
  }

  if (
    body.type === "BlockStatement" &&
    body.body.length === 1 &&
    body.body[0]?.type === "ReturnStatement" &&
    body.body[0].argument?.type === "CallExpression"
  ) {
    return body.body[0].argument;
  }

  return null;
}

function findReference(scope, identifier) {
  let current = scope;
  while (current) {
    for (const reference of current.references) {
      if (reference.identifier === identifier) {
        return reference;
      }
    }
    current = current.upper;
  }
  return null;
}

function isSameFileBinding(context, identifier) {
  const scope = context.sourceCode.getScope(identifier);
  const reference = findReference(scope, identifier);

  if (!reference?.resolved) {
    return false;
  }

  return reference.resolved.defs.some((def) => def.type !== "ImportBinding");
}

function getLocalHelperIdentifier(context, wrappedCall) {
  if (!wrappedCall || wrappedCall.type !== "CallExpression") {
    return null;
  }

  if (isIdentifier(wrappedCall.callee) && isSameFileBinding(context, wrappedCall.callee)) {
    return wrappedCall.callee;
  }

  if (
    wrappedCall.callee?.type === "MemberExpression" &&
    wrappedCall.callee.object?.type === "CallExpression" &&
    isIdentifier(wrappedCall.callee.object.callee) &&
    isSameFileBinding(context, wrappedCall.callee.object.callee)
  ) {
    return wrappedCall.callee.object.callee;
  }

  return null;
}

const noLocalCallWrapper = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow wrapping same-file helper calls in effection call() instead of exposing them as Operations.",
    },
    schema: [],
  },
  create(context) {
    return {
      YieldExpression(node) {
        const wrappedCall = getWrappedCallExpression(node);
        if (!wrappedCall) {
          return;
        }

        const helper = getLocalHelperIdentifier(context, wrappedCall);
        if (!helper) {
          return;
        }

        context.report({
          node: helper,
          message:
            `Local helper '${helper.name}' wrapped in call(). ` +
            `Prefer making '${helper.name}()' return an Operation and yield* it directly.`,
        });
      },
    };
  },
};

function getNamedGeneratorTarget(node) {
  if (node.type === "FunctionDeclaration" && node.id) {
    return node.id;
  }

  if (
    node.type === "FunctionExpression" &&
    node.parent?.type === "VariableDeclarator" &&
    node.parent.id?.type === "Identifier"
  ) {
    return node.parent.id;
  }

  return null;
}

const noTrivialGeneratorWrapper = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow generator helpers whose entire body is a single return yield* wrapper.",
    },
    schema: [],
  },
  create(context) {
    function check(node) {
      if (!isGeneratorFunctionLike(node)) {
        return;
      }

      const target = getNamedGeneratorTarget(node);
      if (!target) {
        return;
      }

      if (!getSingleReturnYield(node)) {
        return;
      }

      context.report({
        node: target,
        message:
          `Generator '${target.name}' only delegates with return yield*. ` +
          `Prefer a plain function that returns the delegated operation directly.`,
      });
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
    };
  },
};

export default {
  meta: {
    name: "tisyn",
  },
  rules: {
    "no-local-call-wrapper": noLocalCallWrapper,
    "no-trivial-generator-wrapper": noTrivialGeneratorWrapper,
  },
};
