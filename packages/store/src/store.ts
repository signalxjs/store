import { guid, Subscription, Topic, InstanceLifetimes } from "@sigx/runtime-core";
import { createTopic, toSubscriber, Utils, defineFactory, SetupFactoryContext } from "@sigx/runtime-core";
import { signal, watch, effectScope, EffectScope } from "@sigx/reactivity";

type MutateFn<T> = (value: T | ((prev: T) => T)) => void;

type StoreStateContext<TState extends object, TInternalState extends object> = {
    state: TState;
    internalState: TInternalState;
};

type StoreActionContext<TState extends object, TInternalState extends object, TGetters, TEvents extends Record<string, Topic<any>>, TSetup extends object> = StoreStateContext<TState, TInternalState> & {
    get: TGetters;
    mutate: {
        [K in keyof TState]: MutateFn<TState[K]>;
    };
    events: TEvents;
    setup: TSetup;
};

export type StoreEvents<TState extends object, TEvents extends Record<string, Topic<any>> = {}> = {
    [K in keyof TState as `onMutated${Capitalize<string & K>}`]: ReturnType<typeof toSubscriber<TState[K]>>;

} & TEvents;

type MapActionOnDispatching<T extends Function> = T extends (...args: infer U) => any ? (...args: U) => void : never;
type MapActionOnDispatched<T extends Function> = T extends (...args: infer U) => Promise<infer Y> | infer Y ? (result: Y, ...args: U) => void : never;
type MapActionOnFailure<T extends Function> = T extends (...args: infer U) => any ? (failureReason: any, ...args: U) => void : never;

export type StoreReturnDefineAction<TAction extends { [key: string]: any }> = {
    onDispatching: {
        [k in keyof TAction]: {
            subscribe(fn: MapActionOnDispatching<TAction[k]>): Subscription
        }
    }
    onDispatched: {
        [k in keyof TAction]: {
            subscribe(fn: MapActionOnDispatched<TAction[k]>): Subscription
        }
    }
    onFailure: {
        [k in keyof TAction]: {
            subscribe(fn: MapActionOnFailure<TAction[k]>): Subscription
        }
    }
} & TAction

export interface SetupStoreContext extends SetupFactoryContext {
    defineState<
        TState extends object,
        TEvents extends Record<string, Topic<any>> = Record<string, Topic<any>>
    >(state: TState): {
        state: TState
        events: StoreEvents<TState, TEvents>
        mutate: {
            [K in keyof TState]: MutateFn<TState[K]>;
        };
    }
    defineActions<TActions extends { [key: string]: any }>(actions: TActions): StoreReturnDefineAction<TActions>
}

export interface IReturnSetupStore<TState, TGetters, TActions extends { [key: string]: Function }, TEvents> {
    state?: TState
    get?: TGetters
    actions?: StoreReturnDefineAction<TActions>
    events?: TEvents
    name?: string
}

export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>>(name: string, setup: (ctx: SetupStoreContext) => InferReturnSetup, lifetime?: InstanceLifetimes): ReturnType<typeof defineFactory<InferReturnSetup>>
export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>, T1>(name: string, setup: (ctx: SetupStoreContext, param1: T1) => InferReturnSetup, lifetime?: InstanceLifetimes): ReturnType<typeof defineFactory<InferReturnSetup, T1>>
export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>, T1, T2>(name: string, setup: (ctx: SetupStoreContext, param1: T1, param2: T2) => InferReturnSetup, lifetime?: InstanceLifetimes): ReturnType<typeof defineFactory<InferReturnSetup, T1, T2>>
export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>, T1, T2, T3>(name: string, setup: (ctx: SetupStoreContext, param1: T1, param2: T2, param3: T3, lifetime?: InstanceLifetimes) => InferReturnSetup): ReturnType<typeof defineFactory<InferReturnSetup, T1, T2, T3>>
export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>, T1, T2, T3, T4>(name: string, setup: (ctx: SetupStoreContext, param1: T1, param2: T2, param3: T3, param4: T4, lifetime?: InstanceLifetimes) => InferReturnSetup): ReturnType<typeof defineFactory<InferReturnSetup, T1, T2, T3, T4>>
export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>, T1, T2, T3, T4, T5>(name: string, setup: (ctx: SetupStoreContext, param1: T1, param2: T2, param3: T3, param4: T4, param5: T5) => InferReturnSetup, lifetime?: InstanceLifetimes): ReturnType<typeof defineFactory<InferReturnSetup, T1, T2, T3, T4, T5>>
export function defineStore<
    TState extends object,
    TGetters extends object,
    TActions extends { [key: string]: any },
    TEvents extends Record<string, ReturnType<typeof toSubscriber<any>>>,
    InferReturnSetup extends IReturnSetupStore<TState, TGetters, TActions, TEvents>
>(name: string, setup: (ctx: SetupStoreContext, ...args: any) => InferReturnSetup, lifetime = InstanceLifetimes.Scoped) {

    return defineFactory<InferReturnSetup>((ctxFactory, ...args: any) => {
        const scope = effectScope(true);
        let messages: Topic<any>[] | null = [] satisfies Topic<any>[];
        const instanceId = guid();
        const id = `${name}_${instanceId}`;

        const result = setup({
            ...ctxFactory,
            defineState: (state) => {
                return defineState(state, id, scope, messages!);
            },
            defineActions: (actions) => {
                return defineActions(actions, id, messages!);
            }
        }, ...args);

        ctxFactory.onDeactivated(() => {
            scope.stop();
            messages?.forEach(m => m.destroy());
            messages = null;
        });

        // add store name for easy debugging
        if (!result.name) {
            result.name = id;
        }
        return result;
    }, lifetime);
}

function defineActions<
    TAction extends { [key: string]: any }
>(
    actions: TAction,
    storeInstanceName: string,
    messages: Topic<any>[]
): StoreReturnDefineAction<TAction> {
    const events: { [key: string]: Topic<any> } = {};
    const namespace = `${storeInstanceName}.actions.${guid()}`;

    const onDispatching: any = {};
    const onDispatched: any = {};
    const onFailure: any = {};
    const result: any = {
        onDispatching,
        onDispatched,
        onFailure
    };

    function getEvent(actionName: string, type: "onDispatching" | "onDispatched" | "onFailure") {
        const name = `${actionName}.${type}`;
        if (!events[name]) {
            events[name] = createTopic({
                namespace: namespace,
                name: name
            });
            messages.push(events[name]);
        }
        return events[name];
    }

    Object.keys(actions).forEach(actionName => {
        // Setup event subscribers
        onDispatching[actionName] = {
            subscribe: (fn: Function) => {
                return getEvent(actionName, "onDispatching").subscribe(function (this: any) {
                    fn.apply(this, arguments[0]);
                });
            }
        };
        onDispatched[actionName] = {
            subscribe: (fn: Function) => {
                return getEvent(actionName, "onDispatched").subscribe(function (this: any) {
                    const msg: { result: any; args: IArguments; } = arguments[0];
                    const allArguments = [msg.result].concat(Array.from(msg.args));
                    fn.apply(this, allArguments);
                });
            }
        };
        onFailure[actionName] = {
            subscribe: (fn: Function) => {
                return getEvent(actionName, "onFailure").subscribe(function (this: any) {
                    const msg: { reason: any; args: IArguments; } = arguments[0];
                    const allArguments = [msg.reason].concat(Array.from(msg.args));
                    fn.apply(this, allArguments);
                });
            }
        };

        // Wrap action
        result[actionName] = function (this: any) {
            try {
                const currentArguments = arguments;
                getEvent(actionName, "onDispatching").publish(currentArguments);

                const returnedResult = actions[actionName].apply(this, currentArguments);
                if (Utils.isPromise(returnedResult)) {
                    (returnedResult as Promise<any>).then(result => {
                        getEvent(actionName, "onDispatched").publish({ result: returnedResult, args: currentArguments });
                    });
                }
                else {
                    getEvent(actionName, "onDispatched").publish({ result: returnedResult, args: currentArguments });
                }

                return returnedResult;
            }
            catch (err) {
                console.error(err);
                getEvent(actionName, "onFailure").publish({ reason: err, args: arguments });
            }
        };
    });

    return result;
}

function defineState<
    TState extends object,
    TEvents extends Record<string, Topic<any>>
>(
    value: TState,
    storeInstanceName: string,
    scope: EffectScope,
    messages: Topic<any>[]
) {

    // Use signal directly for the state
    const state = signal(value);
    const events: any = {};
    const mutate: any = {};

    function initProperty(key: string) {
        // Setup watcher
        scope.run(() => {
            watch(() => (state as any)[key], (newValue: any) => {
                triggerEvent(key, newValue);
            }, { deep: true, immediate: true });
        });

        // Setup mutate
        mutate[key] = (val: any) => {
            try {
                let newValue;
                if (typeof val === "function") {
                    newValue = val((state as any)[key]);
                } else {
                    newValue = val;
                }
                (state as any)[key] = newValue;
            } catch (err) {
                console.error(err);
            }
        };

        // Setup event
        const eventKey = `onMutated${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        if (!events[eventKey]) {
            const topic = createTopic({
                namespace: `${storeInstanceName}.events`,
                name: eventKey
            });
            events[eventKey] = topic;
            messages.push(topic);
        }
    }

    function triggerEvent(name: string, value: any) {
        const keyString = name;
        const afterEventKey = `onMutated${keyString.charAt(0).toUpperCase()}${keyString.slice(1)}`;
        events[afterEventKey]?.publish(value);
    }

    if (value) {
        Object.keys(value).forEach(key => {
            initProperty(key);
        });
    }

    return {
        state: state as TState,
        events: events as StoreEvents<TState, TEvents>,
        mutate: mutate as StoreActionContext<TState, {}, {}, TEvents, {}>["mutate"]
    };
}
