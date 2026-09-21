import argparse
import json
import os
import sys


def load_config(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def apply_hf_token(model_args):
    token = os.environ.get("HUGGINGFACE_TOKEN") or os.environ.get("HF_TOKEN")
    if token and "token" not in model_args:
        model_args["token"] = token
    return model_args


def run_sft(config):
    from unsloth import FastLanguageModel
    from datasets import load_dataset
    from trl import SFTTrainer, SFTConfig

    model_cfg = config["model"]
    dataset_cfg = config["dataset"]
    train_cfg = config["training"]

    output_dir = train_cfg["output_dir"]
    os.makedirs(output_dir, exist_ok=True)

    model_args = {
        "model_name": model_cfg["name"],
        "max_seq_length": model_cfg.get("max_seq_length", 2048),
        "load_in_4bit": model_cfg.get("load_in_4bit", True),
        "use_gradient_checkpointing": model_cfg.get("use_gradient_checkpointing", "unsloth"),
    }
    model_args.update(model_cfg.get("model_args", {}))
    model_args = apply_hf_token(model_args)

    model, tokenizer = FastLanguageModel.from_pretrained(**model_args)

    target_modules = train_cfg.get("target_modules") or [
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        "gate_proj",
        "up_proj",
        "down_proj",
    ]

    lora_args = {
        "r": train_cfg.get("lora_rank", 16),
        "target_modules": target_modules,
        "lora_alpha": train_cfg.get("lora_alpha", 16),
        "lora_dropout": train_cfg.get("lora_dropout", 0),
        "bias": "none",
        "use_gradient_checkpointing": model_cfg.get("use_gradient_checkpointing", "unsloth"),
        "random_state": train_cfg.get("seed", 3407),
        "max_seq_length": model_args.get("max_seq_length", 2048),
        "use_rslora": False,
        "loftq_config": None,
    }
    lora_args.update(train_cfg.get("lora_args", {}))

    model = FastLanguageModel.get_peft_model(model, **lora_args)

    if dataset_cfg["type"] == "huggingface":
        if not dataset_cfg.get("name"):
            raise ValueError("dataset.name is required for huggingface datasets.")
        dataset = load_dataset(
            dataset_cfg["name"],
            split=dataset_cfg.get("split", "train"),
        )
    elif dataset_cfg["type"] == "json":
        if not dataset_cfg.get("data_files"):
            raise ValueError("dataset.data_files is required for json datasets.")
        dataset = load_dataset(
            "json",
            data_files=dataset_cfg["data_files"],
            split=dataset_cfg.get("split", "train"),
        )
    else:
        raise ValueError(f"Unsupported dataset type: {dataset_cfg['type']}")

    trainer_args = {
        "dataset_text_field": dataset_cfg.get("text_field", "text"),
        "max_seq_length": model_args.get("max_seq_length", 2048),
        "per_device_train_batch_size": train_cfg.get("per_device_train_batch_size", 2),
        "gradient_accumulation_steps": train_cfg.get("gradient_accumulation_steps", 4),
        "warmup_steps": train_cfg.get("warmup_steps", 10),
        "max_steps": train_cfg.get("max_steps", 100),
        "learning_rate": train_cfg.get("learning_rate", 2e-4),
        "logging_steps": train_cfg.get("logging_steps", 1),
        "output_dir": output_dir,
        "optim": train_cfg.get("optim", "adamw_8bit"),
        "seed": train_cfg.get("seed", 3407),
    }
    trainer_args.update(train_cfg.get("trainer_args", {}))

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        tokenizer=tokenizer,
        args=SFTConfig(**trainer_args),
    )

    trainer.train()
    trainer.save_model()

    return {
        "success": True,
        "output_dir": output_dir,
        "model_name": model_cfg["name"],
    }


def run_generate(config):
    from transformers import AutoModelForCausalLM, AutoTokenizer, pipeline

    model_args = {"token": os.environ.get("HUGGINGFACE_TOKEN")}
    model_args = {k: v for k, v in model_args.items() if v}

    model = AutoModelForCausalLM.from_pretrained(config["model_path"], **model_args)
    tokenizer = AutoTokenizer.from_pretrained(config["model_path"], **model_args)

    generator = pipeline(
        "text-generation",
        model=model,
        tokenizer=tokenizer,
        max_new_tokens=config.get("max_new_tokens", 256),
        temperature=config.get("temperature", 0.7),
        top_p=config.get("top_p", 0.9),
        do_sample=True,
    )

    result = generator(config["prompt"])
    return {
        "success": True,
        "prompt": config["prompt"],
        "generated_text": result[0]["generated_text"],
    }


def run_export(config):
    if config.get("export_format") != "huggingface":
        raise ValueError("Only huggingface export is supported in runner.")

    from transformers import AutoModelForCausalLM, AutoTokenizer

    output_dir = config["output_path"]
    os.makedirs(output_dir, exist_ok=True)

    model_args = {"token": os.environ.get("HUGGINGFACE_TOKEN")}
    model_args = {k: v for k, v in model_args.items() if v}

    model = AutoModelForCausalLM.from_pretrained(config["model_path"], **model_args)
    tokenizer = AutoTokenizer.from_pretrained(config["model_path"], **model_args)

    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)

    return {
        "success": True,
        "model_path": config["model_path"],
        "output_path": output_dir,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", required=True, choices=["sft", "generate", "export"])
    parser.add_argument("--config", required=True)
    args = parser.parse_args()

    config = load_config(args.config)

    if args.mode == "sft":
        result = run_sft(config)
    elif args.mode == "generate":
        result = run_generate(config)
    elif args.mode == "export":
        result = run_export(config)
    else:
        raise ValueError(f"Unsupported mode: {args.mode}")

    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"success": False, "error": str(exc)}))
        sys.exit(1)
